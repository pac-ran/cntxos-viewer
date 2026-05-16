// POST /api/image-analyze
//
// Vision analysis via Gemini Flash (locked to Flash — never Pro).
// Accepts base64 image data + optional prompt. Returns { description: string }.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GEMINI_FLASH_MODEL = "gemini-2.0-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface RequestBody {
  image_data: string;
  mime_type?: string;
  prompt?: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const { image_data, mime_type = "image/jpeg", prompt = "Describe this image in detail." } = body;

  if (!image_data) {
    return NextResponse.json({ error: "image_data required" }, { status: 400 });
  }

  const geminiBody = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type, data: image_data } },
      ],
    }],
    generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
  };

  const res = await fetch(
    `${GEMINI_API_BASE}/${GEMINI_FLASH_MODEL}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiBody) }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json({ error: `Gemini error ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
  }

  const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const description = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  return NextResponse.json({ description });
}
