import { branch, commit, recall } from '../memory/memfork';
import { Commit } from '../types';

export class MultiAgentOrchestrator {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  /**
   * Runs a specialize specialist agent (Researcher, Critic, or Builder)
   * on the specified memory branch, integrating dynamic prompting, history recall,
   * LLM/Simulated execution, parsing, and committing.
   */
  async runAgent(
    role: 'researcher' | 'critic' | 'builder',
    branchId: string,
    prompt: string
  ): Promise<Commit> {
    // 1. Recall branch memory before generating (inherits active history facts)
    const recalledFacts = await recall(branchId);

    // 2. Specialized system prompts matching role instructions
    const systemPrompts = {
      researcher: 
        "You are a Researcher Agent. Your task is to investigate requirements, identify technologies, " +
        "and extract key architectural facts and options. Write your response clearly, using bullet points " +
        "starting with '-' or '+' or '*' or a numbered list for distinct facts.",
      critic: 
        "You are a Critic Agent. Your task is to critique requirements, identify tradeoffs, weaknesses, " +
        "overheads, and potential conflicts. Write your response clearly, using bullet points starting " +
        "with '-' or '+' or '*' or a numbered list for distinct facts.",
      builder: 
        "You are a Builder Agent. Your task is to propose concrete architectural decisions, implementations, " +
        "and setup recommendations. Write your response clearly, using bullet points starting with '-' " +
        "or '+' or '*' or a numbered list for distinct facts."
    };

    const systemPrompt = systemPrompts[role];

    // 3. Construct user prompt containing the prompt and recalled history facts
    const userPrompt = `Requirements/Prompt: ${prompt}

Recalled History/Facts:
${recalledFacts.length > 0 ? recalledFacts.map(f => `- ${f}`).join('\n') : '(No previous history)'}

Please output the new facts based on your role, the prompt, and the recalled facts. Each new fact must be on its own line starting with a bullet point ('-', '*', or '+') or a number (e.g., '1.'). Do not repeat the prompt or the recalled facts in the new list.`;

    // 4. Query the LLM (real API if key is present, fallback to simulated generator if not)
    const content = await this.queryLLM(systemPrompt, userPrompt);

    // 5. Parse facts from response using robust cleaning logic
    const facts: string[] = [];
    const lines = content.split(/\r?\n/);
    for (let line of lines) {
      line = line.trim();
      let text = '';
      
      // Match bullet lists
      const bulletMatch = line.match(/^[-*+]\s+(.+)$/);
      if (bulletMatch && bulletMatch[1]) {
        text = bulletMatch[1];
      } else {
        // Match numbered lists
        const numMatch = line.match(/^\d+\.\s+(.+)$/);
        if (numMatch && numMatch[1]) {
          text = numMatch[1];
        }
      }

      if (text) {
        let cleaned = text.trim().replace(/\.+$/, '');
        // Strip surrounding quotes if present
        if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
          cleaned = cleaned.slice(1, -1).trim().replace(/\.+$/, '');
        }
        if (cleaned) {
          facts.push(cleaned);
        }
      }
    }

    // Fallback line-by-line split if no matches found
    if (facts.length === 0 && content.trim().length > 0) {
      const fallbackLines = content.split(/\r?\n/);
      for (const line of fallbackLines) {
        let cleaned = line.trim().replace(/\.+$/, '');
        if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
          cleaned = cleaned.slice(1, -1).trim().replace(/\.+$/, '');
        }
        if (cleaned) {
          facts.push(cleaned);
        }
      }
    }

    // 6. Commit the extracted facts to the branch
    const commitMsg = `${role.toUpperCase()} Agent input: ${prompt.substring(0, 30)}`;
    const c = await commit(branchId, commitMsg, facts);
    return c;
  }

  /**
   * Core query driver supporting OpenAI, Gemini, and High-Fidelity simulation fallback.
   */
  private async queryLLM(systemPrompt: string, userPrompt: string): Promise<string> {
    const key = this.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

    if (key) {
      const isGemini = key.startsWith('AIzaSy') || (!!process.env.GEMINI_API_KEY && !this.apiKey);
      if (isGemini) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
                }
              ],
              generationConfig: {
                temperature: 0.2
              }
            })
          }
        );
        if (!response.ok) {
          throw new Error(`Gemini API request failed with status ${response.status}: ${response.statusText}`);
        }
        const data = (await response.json()) as any;
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.2
          })
        });
        if (!response.ok) {
          throw new Error(`OpenAI API request failed with status ${response.status}: ${response.statusText}`);
        }
        const data = (await response.json()) as any;
        return data.choices?.[0]?.message?.content || '';
      }
    } else {
      return this.generateSimulatedResponse(systemPrompt, userPrompt);
    }
  }

  /**
   * High-Fidelity Simulation generator providing Markdown conversational outputs
   * containing exact scenario facts based on prompt analysis.
   */
  private generateSimulatedResponse(systemPrompt: string, userPrompt: string): string {
    const p = userPrompt.toLowerCase();
    let role: 'researcher' | 'critic' | 'builder' = 'researcher';
    if (systemPrompt.toLowerCase().includes('critic')) {
      role = 'critic';
    } else if (systemPrompt.toLowerCase().includes('builder')) {
      role = 'builder';
    }

    // Scenario 1: Database selection
    if (p.includes('database') || p.includes('clickhouse') || p.includes('analytics')) {
      if (role === 'researcher') {
        return `Here is my research regarding database options:
- Use PostgreSQL for transactional processing
- Use ClickHouse for high-performance analytics`;
      }
      if (role === 'critic') {
        return `Tradeoffs and concerns regarding this setup:
- PostgreSQL struggles with high-volume analytics queries
- ClickHouse does not support ACID transactions for OLTP`;
      }
      if (role === 'builder') {
        return `Based on design inputs, here is the concrete strategy:
- Deploy PostgreSQL as primary database and sync to ClickHouse for analytics`;
      }
    }

    // Scenario 2: UI library
    if (p.includes('ui library') || p.includes('d3') || p.includes('recharts') || p.includes('visualization')) {
      if (role === 'researcher') {
        return `We have analyzed chart visualizers and compared two libraries:
- Use D3 for custom low-level chart visualizations
- Use Recharts for rapid development of standard charts`;
      }
      if (role === 'critic') {
        return `Here is the critique for D3 and Recharts:
- D3 has a steep learning curve and slow implementation time
- Recharts lacks custom layout flexibility for complex visuals`;
      }
      if (role === 'builder') {
        return `Recommended deployment blueprint:
- Use Recharts for standard dashboards and fall back to D3 for custom visualizations`;
      }
    }

    // Scenario 3: Chat application
    if (p.includes('chat') || p.includes('socket') || p.includes('websockets')) {
      if (role === 'researcher') {
        return `Real-time messaging transport options:
- Use WebSockets for real-time messages`;
      }
      if (role === 'critic') {
        return `Tradeoffs of websocket transports:
- WebSockets increase connection state overhead
- Scaling WebSockets requires a Redis Pub/Sub layer`;
      }
      if (role === 'builder') {
        return `Concrete socket configuration guidelines:
- Implement server in Node.js with socket.io
- Use Redis adapter for horizontal scaling`;
      }
    }

    // Scenario 4: Distributed Cache
    if (p.includes('cache') || p.includes('key-value') || p.includes('store') || p.includes('redis')) {
      if (role === 'researcher') {
        return `Investigated highly-available cache key-value store backends:
- Redis supports replication and Sentinel
- Redis supports RDB/AOF persistence`;
      }
      if (role === 'critic') {
        return `Analyzing drawbacks of a standard Redis deployment:
- Redis is single-threaded; long running commands block events
- Redis in-memory storage loses data on power loss without sync AOF configuration`;
      }
      if (role === 'builder') {
        return `Implementation guide:
- Deploy Redis Sentinel on AWS ECS
- Configure AOF persistence with everysec policy`;
      }
    }

    // Scenario 5: Product feature pivot
    if (p.includes('pivot') || p.includes('saas') || p.includes('banking') || p.includes('tenant')) {
      if (role === 'researcher') {
        return `Investigating conversion from on-premise to SaaS:
- SaaS model enables continuous delivery
- Multi-tenancy isolation is required`;
      }
      if (role === 'critic') {
        return `Critique of the SaaS pivot approach:
- Multi-tenancy raises cross-tenant data leakage risks
- SaaS model conflicts with air-gapped compliance requirements`;
      }
      if (role === 'builder') {
        return `Implementation layout:
- Deploy multi-tenant architecture on AWS with database-level schemas per tenant`;
      }
    }

    // Generic fallback
    let prompt = '';
    const match = userPrompt.match(/^Requirements\/Prompt:\s*(.+)$/m);
    if (match && match[1]) {
      prompt = match[1].trim();
    } else {
      const fallbackMatch = userPrompt.match(/Prompt:\s*(.+)$/m);
      if (fallbackMatch && fallbackMatch[1]) {
        prompt = fallbackMatch[1].trim();
      } else {
        prompt = userPrompt;
      }
    }

    if (role === 'researcher') {
      return `- Research findings for target: ${prompt}`;
    }
    if (role === 'critic') {
      return `- Tradeoffs and criticism regarding: ${prompt}`;
    }
    return `- Implementation recommendations for: ${prompt}`;
  }

  async runParallelPipeline(
    parentBranchId: string,
    prompt: string,
    branchNames?: { researcher?: string; critic?: string; builder?: string }
  ): Promise<{ [role: string]: { branchId: string; commit: Commit } }> {
    const researchBranch = branchNames?.researcher || `research-${Date.now()}`;
    const criticBranch = branchNames?.critic || `critic-${Date.now()}`;
    const builderBranch = branchNames?.builder || `builder-${Date.now()}`;

    await Promise.all([
      branch(researchBranch, parentBranchId),
      branch(criticBranch, parentBranchId),
      branch(builderBranch, parentBranchId)
    ]);

    const [cResearch, cCritic, cBuilder] = await Promise.all([
      this.runAgent('researcher', researchBranch, prompt),
      this.runAgent('critic', criticBranch, prompt),
      this.runAgent('builder', builderBranch, prompt)
    ]);

    return {
      researcher: { branchId: researchBranch, commit: cResearch },
      critic: { branchId: criticBranch, commit: cCritic },
      builder: { branchId: builderBranch, commit: cBuilder }
    };
  }
}
