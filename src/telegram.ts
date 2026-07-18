interface TgApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = "TelegramError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Persistent reply keyboard shown on /start (§6.5). */
export const MAIN_KEYBOARD = {
  keyboard: [[{ text: "📅 Записаться" }, { text: "💅 Услуги и цены" }, { text: "❌ Отменить запись" }]],
  resize_keyboard: true,
  is_persistent: true,
};

export interface SendOptions {
  parse_mode?: "HTML";
  reply_markup?: unknown;
  disable_link_preview?: boolean;
}

export class Telegram {
  // Wrapped instead of a bare `fetch` reference: detaching fetch from
  // globalThis throws "Illegal invocation" inside workerd.
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async call<T>(method: string, payload: Record<string, unknown>, attempt = 0): Promise<T> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as TgApiResponse<T>;
    if (data.ok && data.result !== undefined) return data.result;
    // Respect Telegram's own back-off hint exactly once, then give up.
    if (data.error_code === 429 && attempt < 1) {
      await sleep(((data.parameters?.retry_after ?? 1) + 0.2) * 1000);
      return this.call(method, payload, attempt + 1);
    }
    throw new TelegramError(data.description ?? `${method} failed`, data.error_code ?? 0);
  }

  sendMessage(chatId: number, text: string, opts: SendOptions = {}): Promise<{ message_id: number }> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      ...(opts.parse_mode ? { parse_mode: opts.parse_mode } : {}),
      ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
      ...(opts.disable_link_preview ? { link_preview_options: { is_disabled: true } } : {}),
    });
  }

  sendChatAction(chatId: number, action = "typing"): Promise<boolean> {
    return this.call("sendChatAction", { chat_id: chatId, action });
  }

  /** Metadata (incl. file_path) for a Telegram file id; used to fetch voice notes. */
  getFile(fileId: string): Promise<{ file_id: string; file_path?: string; file_size?: number }> {
    return this.call("getFile", { file_id: fileId });
  }

  /** Direct download URL for a file_path returned by getFile. */
  fileUrl(filePath: string): string {
    return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
  }

  /**
   * Send an audio bubble. Bot API accepts .OGG/OPUS, .MP3 and .M4A for sendVoice;
   * the multipart filename MUST carry an extension or Telegram treats it as a document.
   */
  async sendVoice(chatId: number, audio: ArrayBuffer, caption: string, filename = "voice.mp3"): Promise<void> {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (caption) form.append("caption", caption);
    form.append("voice", new Blob([audio]), filename);
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/sendVoice`, {
      method: "POST",
      body: form,
    });
    const data = (await res.json()) as TgApiResponse<unknown>;
    if (!data.ok) throw new TelegramError(data.description ?? "sendVoice failed", data.error_code ?? 0);
  }

  setWebhook(url: string, secretToken: string): Promise<boolean> {
    return this.call("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
  }
}
