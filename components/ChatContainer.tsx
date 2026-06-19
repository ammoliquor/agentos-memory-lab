"use client";

import { Message } from "@/lib/types";
import { useState, useRef, useEffect } from "react";
import ChatMessage from "./ChatMessage";
import { Send, Loader } from "lucide-react";

interface ChatProps {
  branchId: string;
  initialMessages: Message[];
}

export default function ChatContainer({ branchId, initialMessages }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  
  const bottomRef = useRef<HTMLDivElement>(null);

  // Reset messages when branchId changes
  useEffect(() => {
    setMessages(initialMessages);
  }, [branchId, initialMessages]);

  // Auto-scroll logic
  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const prompt = input;
    setInput("");
    setIsLoading(true);
    setStatusText("Initializing orchestrator...");

    try {
      // Initiate SSE streaming request
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, branchId }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to start stream");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Parse event stream formats
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || ""; // Retain incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          // Parse SSE fields
          const eventMatch = line.match(/^event: (.+)$/m);
          const dataMatch = line.match(/^data: (.+)$/m);

          if (dataMatch) {
            const event = eventMatch ? eventMatch[1] : "message";
            const rawData = dataMatch[1];
            const parsedData = JSON.parse(rawData);

            if (event === "message") {
              const msg = parsedData as Message;
              // Append to list, filtering out duplicates
              setMessages((prev) => {
                if (prev.some((m) => m.id === msg.id)) return prev;
                return [...prev, msg];
              });
            } else if (event === "status") {
              if (parsedData.state === "orchestrating") {
                setStatusText("Running parallel agent forks (Researcher, Critic, Builder)...");
              } else if (parsedData.state === "done") {
                setStatusText("");
              }
            } else if (event === "error") {
              console.error("Stream error: ", parsedData.message);
              setStatusText(`Error: ${parsedData.message}`);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(err);
      setStatusText(`Connection failed: ${err.message}`);
    } finally {
      setIsLoading(false);
      setStatusText("");
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Scrollable Message Flow */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 flex flex-col">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 space-y-2 select-none">
            <Send className="w-8 h-8 text-zinc-600 rotate-45" />
            <p className="text-sm">Initiate multi-agent pipeline by sending a prompt</p>
          </div>
        ) : (
          messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
        )}
        
        {/* Loading / Status Streaming Panel */}
        {isLoading && (
          <div className="flex items-center space-x-2.5 p-3 rounded-lg border border-[#27272a] bg-[#18181b]/50 text-xs text-zinc-400 self-start mr-12">
            <Loader className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            <span>{statusText || "Waiting for agent responses..."}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input Form Footer */}
      <div className="p-4 border-t border-[#27272a] bg-[#18181b]/10">
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-2">
          <input
            type="text"
            disabled={isLoading}
            placeholder="Ask agent orchestrator to plan, criticize, or research designs..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-zinc-900 border border-[#27272a] rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:hover:bg-indigo-600 text-sm font-medium"
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
