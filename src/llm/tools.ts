// Gemini functionDeclarations — Appendix C, applied verbatim. The dispatcher
// (validation + last_offered lock + engine calls) is implemented in stage 3.

export const toolDeclarations = [
  {
    name: "checkFreeSlots",
    description:
      "Получить список СВОБОДНЫХ окон для услуги. Вызывай перед любым предложением времени. Предлагать клиенту можно только слоты из ответа.",
    parameters: {
      type: "object",
      properties: {
        service_id: { type: "integer", description: "ID услуги из списка в системном промпте" },
        from_date: { type: "string", description: "Начало диапазона, YYYY-MM-DD, локальная дата бизнеса" },
        to_date: {
          type: "string",
          description: "Конец диапазона включительно, YYYY-MM-DD. Для одного дня равен from_date",
        },
        part_of_day: {
          type: "string",
          enum: ["any", "morning", "afternoon", "evening"],
          description: "morning — до 12:00, afternoon — 12:00–16:59, evening — с 17:00",
        },
      },
      required: ["service_id", "from_date", "to_date"],
    },
  },
  {
    name: "bookSlot",
    description:
      "Забронировать слот. slot_start бери ТОЛЬКО из поля start последнего ответа checkFreeSlots. Перед вызовом обязательно узнай имя клиента.",
    parameters: {
      type: "object",
      properties: {
        service_id: { type: "integer" },
        slot_start: { type: "string", description: "Значение поля start выбранного слота, формат YYYY-MM-DDTHH:mm" },
        client_name: { type: "string" },
        client_phone: { type: "string", description: "Если клиент назвал. Казахстанский формат +7XXXXXXXXXX" },
      },
      required: ["service_id", "slot_start", "client_name"],
    },
  },
  {
    name: "cancelBooking",
    description:
      "confirm=false — узнать ближайшую активную запись клиента (ничего не отменяет, используй для вопросов о записи и для переноса). confirm=true — отменить её; вызывай так только после явного «да, отмените».",
    parameters: {
      type: "object",
      properties: {
        confirm: { type: "boolean" },
      },
      required: ["confirm"],
    },
  },
  {
    name: "qualifyLead",
    description:
      "Сохранить заявку для владельца, когда запись сейчас не происходит: нет подходящих слотов, клиент думает, нестандартная услуга, или просто оставил контакты. Заполняй только из слов клиента.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        service: { type: "string", description: "Что нужно клиенту, его же словами" },
        budget: { type: "string" },
        urgency: { type: "string", enum: ["today", "tomorrow", "this_week", "flexible"] },
        summary: { type: "string", description: "1–2 предложения для владельца: кто, что хочет, когда" },
      },
      required: ["service", "summary"],
    },
  },
  {
    name: "handoffToOwner",
    description:
      "Позвать живого администратора: жалоба, конфликт, нестандартный вопрос, прямая просьба позвать человека, или ты дважды не смог помочь.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Кратко: почему нужен человек" },
      },
      required: ["reason"],
    },
  },
];
