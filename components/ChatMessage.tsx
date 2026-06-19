import { Message } from "@/lib/types";
import { User, ShieldAlert, Cpu, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  message: Message;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const { agentType } = message;

  // Compute themes and icons
  let title = "User";
  let icon = <User className="w-3.5 h-3.5" />;
  let cardClass = "bg-zinc-900/50 border-zinc-800/80 text-zinc-200 self-start";
  let badgeClass = "bg-zinc-800 text-zinc-400";

  if (isUser) {
    cardClass = "bg-indigo-950/20 border-indigo-500/30 text-indigo-100 self-end ml-12";
    badgeClass = "bg-indigo-900/40 text-indigo-300";
  } else if (agentType === "researcher") {
    title = "Researcher Agent";
    icon = <Sparkles className="w-3.5 h-3.5" />;
    cardClass = "bg-blue-950/20 border-blue-500/30 text-blue-100 self-start mr-12 border-l-4 border-l-blue-500";
    badgeClass = "bg-blue-900/40 text-blue-300";
  } else if (agentType === "critic") {
    title = "Critic Agent";
    icon = <ShieldAlert className="w-3.5 h-3.5" />;
    cardClass = "bg-orange-950/20 border-orange-500/30 text-orange-100 self-start mr-12 border-l-4 border-l-orange-500";
    badgeClass = "bg-orange-900/40 text-orange-300";
  } else if (agentType === "builder") {
    title = "Builder Agent";
    icon = <Cpu className="w-3.5 h-3.5" />;
    cardClass = "bg-emerald-950/20 border-emerald-500/30 text-emerald-100 self-start mr-12 border-l-4 border-l-emerald-500";
    badgeClass = "bg-emerald-900/40 text-emerald-300";
  }

  return (
    <div className={cn("flex flex-col max-w-[85%] rounded-lg p-4 border transition-all shadow-sm", cardClass)}>
      {/* Card Header Tag */}
      <div className="flex items-center space-x-1.5 mb-2.5">
        <span className={cn("flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider", badgeClass)}>
          {icon}
          {title}
        </span>
        <span className="text-[10px] text-zinc-500">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Message Content */}
      <div className="text-sm leading-relaxed whitespace-pre-wrap font-sans text-zinc-300">
        {message.content}
      </div>
    </div>
  );
}
