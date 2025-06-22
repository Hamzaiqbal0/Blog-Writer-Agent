import { NextRequest, NextResponse } from 'next/server'
import { config } from 'dotenv'
import OpenAI from 'openai'

config()

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
})

export async function POST(req: NextRequest) {
  const { prompt } = await req.json()

  const chatResponse = await openai.chat.completions.create({
    model: 'deepseek/deepseek-r1-0528:free',
    messages: [
      {
        role: 'system',
        content: `
You are a professional blog writing assistant. Your job is to write engaging and informative blogs. Follow these rules:
- Start with a catchy title and intro
- Use clear headings
- Mention at least 2 to 3 references
- Suggest a royalty-free image with markdown
- Use markdown formatting
        `,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  const content = chatResponse.choices[0].message.content
  return NextResponse.json({ content })
}
