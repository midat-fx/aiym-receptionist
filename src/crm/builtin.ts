import type { CrmConfig } from "../config";
import { getBusinessById } from "../db";
import type { Env } from "../env";
import { Telegram } from "../telegram";
import type { CrmAdapter, CrmEvent } from "./adapter";

/** Always-on adapter: notifies the business owner in Telegram (bound via /owner <admin_token>). */
export const builtinAdapter: CrmAdapter = {
  name: "builtin",
  enabled(_cfg: CrmConfig, _env: Env): boolean {
    return true;
  },
  async push(event: CrmEvent, _cfg: CrmConfig, env: Env): Promise<void> {
    const biz = await getBusinessById(env.DB, event.business_id);
    if (!biz?.tg_bot_token || biz.owner_tg_chat_id == null) return; // no owner bound yet
    const tg = new Telegram(biz.tg_bot_token);

    let text: string;
    if (event.type === "booking_created") {
      const tail = [event.master, event.client_name, event.client_phone].filter(Boolean).join(" · ");
      text = `🆕 Запись: ${event.service ?? ""} · ${event.label ?? ""}${tail ? " · " + tail : ""}`;
    } else if (event.type === "booking_cancelled") {
      text = `❌ Отмена: ${event.summary}`;
    } else {
      text = `📝 Заявка: ${event.summary}`;
    }
    await tg.sendMessage(biz.owner_tg_chat_id, text);
  },
};
