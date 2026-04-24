import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import express from 'express'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import OpenAI from 'openai'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(projectRoot, '.env') })
const dataDirectory = path.join(projectRoot, 'server', 'data')
const usersFile = path.join(dataDirectory, 'users.json')
const statesFile = path.join(dataDirectory, 'states.json')
const authCookieName = 'flashcraft_session'
const port = Number(process.env.PORT || 3001)
const jwtSecret = process.env.JWT_SECRET || 'flashcraft-local-dev-secret'
const isProduction = process.env.NODE_ENV === 'production'

const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  storage: multer.memoryStorage(),
})

function ensureDataStore() {
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true })
  }

  if (!fs.existsSync(usersFile)) {
    writeJson(usersFile, [])
  }

  if (!fs.existsSync(statesFile)) {
    writeJson(statesFile, {})
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(filePath, value) {
  const tempFile = `${filePath}.tmp`
  fs.writeFileSync(tempFile, JSON.stringify(value, null, 2))
  fs.renameSync(tempFile, filePath)
}

function normaliseEmail(email) {
  return email.trim().toLowerCase()
}

function sanitizeUser(user) {
  return {
    createdAt: user.createdAt,
    email: user.email,
    id: user.id,
    name: user.name,
  }
}

function createToken(user) {
  return jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '14d' })
}

function setSessionCookie(response, user) {
  response.cookie(authCookieName, createToken(user), {
    httpOnly: true,
    maxAge: 14 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: isProduction,
  })
}

function clearSessionCookie(response) {
  response.clearCookie(authCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
  })
}

function getCurrentUser(request) {
  const token = request.cookies?.[authCookieName]
  if (!token) return null

  try {
    const decoded = jwt.verify(token, jwtSecret)
    const userId = typeof decoded === 'object' && decoded ? decoded.sub : null
    if (typeof userId !== 'string') return null
    const users = readJson(usersFile, [])
    return users.find((user) => user.id === userId) ?? null
  } catch {
    return null
  }
}

function requireAuth(request, response, next) {
  const user = getCurrentUser(request)
  if (!user) {
    response.status(401).json({ error: 'You must sign in to access this feature.' })
    return
  }

  request.user = user
  next()
}

function validateStatePayload(state) {
  if (!state || typeof state !== 'object') return false
  if (!Array.isArray(state.decks) || !Array.isArray(state.cards)) return false
  if (!(typeof state.activeDeckId === 'string' || state.activeDeckId === null)) return false
  return true
}

async function extractSourceText(file, notes) {
  const noteText = typeof notes === 'string' ? notes.trim() : ''

  if (file?.mimetype === 'application/pdf') {
    const result = await pdfParse(file.buffer)
    return {
      sourceLabel: file.originalname,
      text: [noteText, result.text ?? ''].filter(Boolean).join('\n\n'),
    }
  }

  if (file) {
    return {
      sourceLabel: file.originalname,
      text: [noteText, file.buffer.toString('utf8')].filter(Boolean).join('\n\n'),
    }
  }

  return {
    sourceLabel: 'pasted notes',
    text: noteText,
  }
}

async function generateFlashcardsFromText({ deckContext, desiredCount, sourceLabel, text }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured. Add it to your environment before using AI imports.')
  }

  const trimmedSource = text.trim().slice(0, 32000)
  if (!trimmedSource) {
    throw new Error('Add some notes or upload a PDF before generating flashcards.')
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const response = await client.responses.create({
    input: [
      {
        content: [
          {
            text:
              'You convert study notes into revision flashcards. Make cards atomic, exam-relevant, non-redundant, and easy to review with spaced repetition. Keep answers concise but sufficient for active recall. Return JSON only.',
            type: 'input_text',
          },
        ],
        role: 'system',
      },
      {
        content: [
          {
            text: `Create ${desiredCount} flashcards from the following source. Context about the target deck: ${deckContext || 'None provided'}.\n\nSource label: ${sourceLabel}\n\nNotes:\n${trimmedSource}`,
            type: 'input_text',
          },
        ],
        role: 'user',
      },
    ],
    model: process.env.OPENAI_MODEL || 'gpt-5.4',
    text: {
      format: {
        name: 'flashcraft_flashcards',
        strict: true,
        type: 'json_schema',
        schema: {
          additionalProperties: false,
          properties: {
            cards: {
              items: {
                additionalProperties: false,
                properties: {
                  back: { type: 'string' },
                  front: { type: 'string' },
                  hint: { type: 'string' },
                  mnemonic: { type: 'string' },
                  tags: {
                    items: { type: 'string' },
                    type: 'array',
                  },
                },
                required: ['front', 'back', 'hint', 'mnemonic', 'tags'],
                type: 'object',
              },
              maxItems: 24,
              minItems: 1,
              type: 'array',
            },
            sourceExcerpt: { type: 'string' },
            sourceLabel: { type: 'string' },
            suggestedDeckDescription: { type: 'string' },
            suggestedDeckTitle: { type: 'string' },
            summary: { type: 'string' },
          },
          required: [
            'suggestedDeckTitle',
            'suggestedDeckDescription',
            'summary',
            'sourceLabel',
            'sourceExcerpt',
            'cards',
          ],
          type: 'object',
        },
      },
    },
  })

  return JSON.parse(response.output_text)
}

ensureDataStore()

const app = express()

app.use(express.json({ limit: '4mb' }))
app.use(cookieParser())

app.get('/api/health', (_request, response) => {
  response.json({
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    ok: true,
  })
})

app.get('/api/auth/session', (request, response) => {
  const user = getCurrentUser(request)
  response.json({ user: user ? sanitizeUser(user) : null })
})

app.post('/api/auth/register', async (request, response) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : ''
  const email = typeof request.body?.email === 'string' ? normaliseEmail(request.body.email) : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''

  if (!name || !email || password.length < 8) {
    response.status(400).json({ error: 'Enter a name, a valid email, and a password with at least 8 characters.' })
    return
  }

  const users = readJson(usersFile, [])
  if (users.some((user) => user.email === email)) {
    response.status(409).json({ error: 'An account already exists for that email address.' })
    return
  }

  const user = {
    createdAt: new Date().toISOString(),
    email,
    id: crypto.randomUUID(),
    name,
    passwordHash: await bcrypt.hash(password, 10),
  }

  users.push(user)
  writeJson(usersFile, users)

  const states = readJson(statesFile, {})
  states[user.id] = {
    activeDeckId: null,
    cards: [],
    decks: [],
    updatedAt: new Date().toISOString(),
  }
  writeJson(statesFile, states)

  setSessionCookie(response, user)
  response.status(201).json({ user: sanitizeUser(user) })
})

app.post('/api/auth/login', async (request, response) => {
  const email = typeof request.body?.email === 'string' ? normaliseEmail(request.body.email) : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''
  const users = readJson(usersFile, [])
  const user = users.find((entry) => entry.email === email)

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    response.status(401).json({ error: 'Incorrect email or password.' })
    return
  }

  setSessionCookie(response, user)
  response.json({ user: sanitizeUser(user) })
})

app.post('/api/auth/logout', (_request, response) => {
  clearSessionCookie(response)
  response.json({ ok: true })
})

app.get('/api/app-state', requireAuth, (request, response) => {
  const states = readJson(statesFile, {})
  response.json({ state: states[request.user.id] ?? null })
})

app.put('/api/app-state', requireAuth, (request, response) => {
  const state = request.body?.state
  if (!validateStatePayload(state)) {
    response.status(400).json({ error: 'State payload is invalid.' })
    return
  }

  const states = readJson(statesFile, {})
  states[request.user.id] = {
    ...state,
    updatedAt: new Date().toISOString(),
  }
  writeJson(statesFile, states)
  response.json({ ok: true, savedAt: states[request.user.id].updatedAt })
})

app.post('/api/ai/generate', requireAuth, upload.single('sourceFile'), async (request, response) => {
  try {
    const desiredCount = Math.min(24, Math.max(4, Number(request.body?.desiredCount) || 8))
    const deckContext = typeof request.body?.deckContext === 'string' ? request.body.deckContext.trim() : ''
    const { sourceLabel, text } = await extractSourceText(request.file, request.body?.notes)
    const result = await generateFlashcardsFromText({
      deckContext,
      desiredCount,
      sourceLabel,
      text,
    })

    response.json({
      result: {
        ...result,
        sourceExcerpt: result.sourceExcerpt || text.slice(0, 240),
        sourceLabel: result.sourceLabel || sourceLabel,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI generation failed.'
    response.status(500).json({ error: message })
  }
})

const distDirectory = path.join(projectRoot, 'dist')
if (process.env.NODE_ENV === 'production' && fs.existsSync(distDirectory)) {
  app.use(express.static(distDirectory))
  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(path.join(distDirectory, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`Flashcraft server running on http://localhost:${port}`)
})
