import type { Analyzer, GrammarNote, Lang, Library, Note, SentenceNote, WordNote } from '@fragmemo/core'

// Conversation model shared by every provider. Close to the OpenAI chat format, which the
// API provider speaks natively; CLI providers keep their own transcript and only report events.

export interface ToolCall { id: string; name: string; input: unknown }

export type Msg =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export interface AssistantTurn { text: string; toolCalls: ToolCall[] }

/** A tool as a model sees it: name, description, JSON Schema of the input. */
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; input: unknown }
  | { type: 'tool-result'; name: string; output: string; error?: boolean }
  | { type: 'step'; step: number }

export type ProviderId = 'claude-cli' | 'codex-cli' | 'openai-compatible'

interface ProviderBase {
  id: ProviderId
  available(): Promise<boolean>
}

/** A chat API: the harness runs the tool loop, one model turn per `step`. */
export interface ApiProvider extends ProviderBase {
  kind: 'api'
  step(req: { system: string; messages: Msg[]; tools?: ToolSpec[]; signal: AbortSignal }, onText?: (delta: string) => void): Promise<AssistantTurn>
}

/**
 * A local agent CLI: it runs the tool loop itself and reaches our tools through MCP, which the
 * host serves by forwarding to `call`. `session` continues an earlier conversation.
 */
export interface CliProvider extends ProviderBase {
  kind: 'cli'
  /** False when the CLI cannot resume a session: earlier turns are then folded into the prompt. */
  resumable?: boolean
  run(req: {
    system: string
    prompt: string
    session?: string
    tools: ToolSpec[]
    call: (name: string, input: unknown) => Promise<{ output: string; error?: boolean }>
    maxSteps: number
    signal: AbortSignal
    onEvent?: (e: AgentEvent) => void
  }): Promise<{ text: string; session?: string }>
}

export type Provider = ApiProvider | CliProvider

/** Standard notes only: raw Anki notes are never written by AI. */
export type StandardNote = WordNote | SentenceNote | GrammarNote

export interface Proposal {
  note: StandardNote
  deckId: string
  /** False when it modifies a note already in the Library. */
  isNew: boolean
  /** The note as it was before, for modifications; what an undo restores. */
  before?: Note
}

/** Everything a run proposes to write, keyed by note id. Nothing touches disk until the pipeline applies it. */
export interface ChangeSet { proposals: Map<string, Proposal> }

export interface ToolCtx {
  library: Library
  analyzer: Analyzer
  lang: Lang
  /** Where new notes go. */
  deckId?: string
  changes: ChangeSet
  ids: { ulid(): string }
  signal: AbortSignal
}
