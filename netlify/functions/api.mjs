import bcrypt from 'bcryptjs'
import Busboy from 'busboy'
import { getStore } from '@netlify/blobs'
import jwt from 'jsonwebtoken'
import OpenAI from 'openai'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import fs from 'node:fs'
import path from 'node:path'

const authCookieName = 'flashcraft_session'
const isProduction = process.env.NODE_ENV === 'production'

const localDataDir = path.join(process.env.TMPDIR || '/tmp', 'flashcraft-netlify-state')
const localStoreFile = path.join(localDataDir, 'flashcraft.json')

async function localReadAll() {
  try {
    const raw = await fs.promises.readFile(localStoreFile, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function localWriteAll(data) {
  await fs.promises.mkdir(localDataDir, { recursive: true })
  await fs.promises.writeFile(localStoreFile, JSON.stringify(data, null, 2), 'utf8')
}

async function kvGet(key) {
  try {
    const store = getStore({ name: 'flashcraft' })
    return await store.get(key)
  } catch {
    if (isProduction) {
      throw new Error('Netlify Blobs is unavailable in production.')
    }
    // Fall back for local dev when blobs auth is unavailable.
  }
  const data = await localReadAll()
  return typeof data[key] === 'string' ? data[key] : null
}

async function kvSet(key, value) {
  try {
    const store = getStore({ name: 'flashcraft' })
    await store.set(key, value)
    return
  } catch {
    if (isProduction) {
      throw new Error('Netlify Blobs is unavailable in production.')
    }
    // Fall back for local dev when blobs auth is unavailable.
  }
  const data = await localReadAll()
  data[key] = value
  await localWriteAll(data)
}

function json(statusCode, body, headers = {}) {
  return {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    statusCode,
  }
}

function getJwtSecret() {
  return process.env.JWT_SECRET || 'flashcraft-local-dev-secret'
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

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {}
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const equalsIndex = part.indexOf('=')
      if (equalsIndex === -1) return acc
      const key = decodeURIComponent(part.slice(0, equalsIndex).trim())
      const value = decodeURIComponent(part.slice(equalsIndex + 1).trim())
      acc[key] = value
      return acc
    }, {})
}

function createToken(user) {
  return jwt.sign({ sub: user.id }, getJwtSecret(), { expiresIn: '14d' })
}

function createSessionCookie(user) {
  const secure = isProduction ? '; Secure' : ''
  return `${authCookieName}=${encodeURIComponent(createToken(user))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 24 * 60 * 60}${secure}`
}

function clearSessionCookie() {
  const secure = isProduction ? '; Secure' : ''
  return `${authCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

async function readUsers() {
  const raw = await kvGet('users')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeUsers(users) {
  await kvSet('users', JSON.stringify(users))
}

async function readState(userId) {
  const raw = await kvGet(`state:${userId}`)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeState(userId, state) {
  await kvSet(`state:${userId}`, JSON.stringify(state))
}

async function getCurrentUser(event) {
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie)
  const token = cookies[authCookieName]
  if (!token) return null

  try {
    const decoded = jwt.verify(token, getJwtSecret())
    const userId = typeof decoded === 'object' && decoded ? decoded.sub : null
    if (typeof userId !== 'string') return null
    const users = await readUsers()
    return users.find((user) => user.id === userId) ?? null
  } catch {
    return null
  }
}

function validateStatePayload(state) {
  if (!state || typeof state !== 'object') return false
  if (!Array.isArray(state.decks) || !Array.isArray(state.cards)) return false
  if (!(typeof state.activeDeckId === 'string' || state.activeDeckId === null)) return false
  return true
}

async function parseJsonBody(event) {
  if (!event.body) return {}
  try {
    return JSON.parse(event.body)
  } catch {
    return {}
  }
}

async function parseMultipartBody(event) {
  return new Promise((resolve, reject) => {
    const contentType = event.headers['content-type'] || event.headers['Content-Type']
    if (!contentType) {
      resolve({ fields: {}, file: null })
      return
    }

    const fields = {}
    let file = null
    const busboy = Busboy({
      headers: {
        'content-type': contentType,
      },
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
      },
    })

    busboy.on('field', (name, value) => {
      fields[name] = value
    })

    busboy.on('file', (name, stream, info) => {
      if (name !== 'sourceFile') {
        stream.resume()
        return
      }

      const chunks = []
      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('end', () => {
        file = {
          buffer: Buffer.concat(chunks),
          mimetype: info.mimeType,
          originalname: info.filename,
        }
      })
    })

    busboy.on('error', reject)
    busboy.on('finish', () => resolve({ fields, file }))

    const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '')
    busboy.end(body)
  })
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

function getRoutePath(event) {
  const path = event.path || '/'
  if (path.startsWith('/.netlify/functions/api')) {
    return path.slice('/.netlify/functions/api'.length) || '/'
  }
  if (path.startsWith('/api')) {
    return path.slice('/api'.length) || '/'
  }
  return path
}

export const handler = async (event) => {
  const method = event.httpMethod
  const routePath = getRoutePath(event)

  if (method === 'GET' && routePath === '/health') {
    return json(200, {
      aiConfigured: Boolean(process.env.OPENAI_API_KEY),
      ok: true,
    })
  }

  if (method === 'GET' && routePath === '/auth/session') {
    const user = await getCurrentUser(event)
    return json(200, { user: user ? sanitizeUser(user) : null })
  }

  if (method === 'POST' && routePath === '/auth/register') {
    const body = await parseJsonBody(event)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const email = typeof body?.email === 'string' ? normaliseEmail(body.email) : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!name || !email || password.length < 8) {
      return json(400, { error: 'Enter a name, a valid email, and a password with at least 8 characters.' })
    }

    const users = await readUsers()
    if (users.some((user) => user.email === email)) {
      return json(409, { error: 'An account already exists for that email address.' })
    }

    const user = {
      createdAt: new Date().toISOString(),
      email,
      id: crypto.randomUUID(),
      name,
      passwordHash: await bcrypt.hash(password, 10),
    }
    users.push(user)
    await writeUsers(users)
    await writeState(user.id, {
      activeDeckId: null,
      cards: [],
      decks: [],
      updatedAt: new Date().toISOString(),
    })

    return json(201, { user: sanitizeUser(user) }, { 'Set-Cookie': createSessionCookie(user) })
  }

  if (method === 'POST' && routePath === '/auth/login') {
    const body = await parseJsonBody(event)
    const email = typeof body?.email === 'string' ? normaliseEmail(body.email) : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const users = await readUsers()
    const user = users.find((entry) => entry.email === email)

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return json(401, { error: 'Incorrect email or password.' })
    }

    return json(200, { user: sanitizeUser(user) }, { 'Set-Cookie': createSessionCookie(user) })
  }

  if (method === 'POST' && routePath === '/auth/logout') {
    return json(200, { ok: true }, { 'Set-Cookie': clearSessionCookie() })
  }

  const currentUser = await getCurrentUser(event)
  if (!currentUser) {
    return json(401, { error: 'You must sign in to access this feature.' })
  }

  if (method === 'GET' && routePath === '/app-state') {
    const state = await readState(currentUser.id)
    return json(200, { state })
  }

  if (method === 'PUT' && routePath === '/app-state') {
    const body = await parseJsonBody(event)
    const state = body?.state
    if (!validateStatePayload(state)) {
      return json(400, { error: 'State payload is invalid.' })
    }

    const nextState = {
      ...state,
      updatedAt: new Date().toISOString(),
    }
    await writeState(currentUser.id, nextState)
    return json(200, { ok: true, savedAt: nextState.updatedAt })
  }

  if (method === 'POST' && routePath === '/ai/generate') {
    try {
      const { fields, file } = await parseMultipartBody(event)
      const desiredCount = Math.min(24, Math.max(4, Number(fields?.desiredCount) || 8))
      const deckContext = typeof fields?.deckContext === 'string' ? fields.deckContext.trim() : ''
      const { sourceLabel, text } = await extractSourceText(file, fields?.notes)
      const result = await generateFlashcardsFromText({
        deckContext,
        desiredCount,
        sourceLabel,
        text,
      })

      return json(200, {
        result: {
          ...result,
          sourceExcerpt: result.sourceExcerpt || text.slice(0, 240),
          sourceLabel: result.sourceLabel || sourceLabel,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI generation failed.'
      return json(500, { error: message })
    }
  }

  return json(404, { error: 'Not found' })
}
