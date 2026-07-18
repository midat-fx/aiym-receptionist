# Aiym — AI receptionist

Virtual receptionist for small businesses (salons, clinics, auto services). A client
writes or sends a voice note — *"book me for 3pm tomorrow"* — and Aiym answers in text
and voice, offers open slots, books the appointment and notifies the owner.

**Sacred principle:** the LLM only understands speech and extracts intent; availability
checks and writes are done exclusively by a deterministic engine on Cloudflare D1 with
tests. Double-booking is impossible at the database level.

Runs at **$0/month** on free tiers: Cloudflare Workers + D1 + KV, Workers AI (Whisper STT),
Gemini function calling, ElevenLabs TTS.

> 🚧 Work in progress — being built stage by stage per `PLAN.md`. Full README (live demo,
> architecture, cost breakdown) lands in stage 7.

## Stack

Cloudflare Workers · D1 · KV · Workers AI (Whisper) · Gemini · ElevenLabs · TypeScript, zero runtime deps.

## Author

Midat Faizov · [github.com/midat-fx](https://github.com/midat-fx)
