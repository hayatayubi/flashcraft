import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import express from 'express'
import jwt from 'jsonwebtoken'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(projectRoot, '.env') })
const dataDirectory = process.env.FLASHCRAFT_DATA_DIR || path.join(projectRoot, 'server', 'data')
const usersFile = path.join(dataDirectory, 'users.json')
const statesFile = path.join(dataDirectory, 'states.json')
const authCookieName = 'flashcraft_session'
const port = Number(process.env.PORT || 3001)
const jwtSecret = process.env.JWT_SECRET || 'flashcraft-local-dev-secret'
const isProduction = process.env.NODE_ENV === 'production'

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

const localMode = process.env.FLASHCRAFT_LOCAL_MODE === '1'

function ensureLocalUser() {
  const users = readJson(usersFile, [])
  if (users.length > 0) return users[0]

  const localUser = {
    createdAt: new Date().toISOString(),
    email: 'local@flashcraft.app',
    id: crypto.randomUUID(),
    name: 'You',
    passwordHash: '',
  }
  users.push(localUser)
  writeJson(usersFile, users)

  const states = readJson(statesFile, {})
  if (!states[localUser.id]) {
    states[localUser.id] = {
      activeDeckId: null,
      cards: [],
      decks: [],
      updatedAt: new Date().toISOString(),
    }
    writeJson(statesFile, states)
  }
  return localUser
}

function getCurrentUser(request) {
  if (localMode) {
    return ensureLocalUser()
  }

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

ensureDataStore()

const app = express()

app.use(express.json({ limit: '4mb' }))
app.use(cookieParser())

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
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

const distDirectory = process.env.FLASHCRAFT_DIST_DIR || path.join(projectRoot, 'dist')
if ((process.env.NODE_ENV === 'production' || process.env.FLASHCRAFT_SERVE_STATIC === '1') && fs.existsSync(distDirectory)) {
  app.use(express.static(distDirectory))
  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(path.join(distDirectory, 'index.html'))
  })
}

export function startServer({ port: customPort } = {}) {
  return new Promise((resolve) => {
    const server = app.listen(customPort ?? port, () => {
      const address = server.address()
      const boundPort = typeof address === 'object' && address ? address.port : port
      console.log(`Flashcraft server running on http://localhost:${boundPort}`)
      resolve({ server, port: boundPort })
    })
  })
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename
if (isDirectRun) {
  startServer()
}
