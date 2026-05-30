import { app, BrowserWindow, Menu, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isDev = !app.isPackaged

const userDataDir = app.getPath('userData')
const dataDirectory = path.join(userDataDir, 'data')
fs.mkdirSync(dataDirectory, { recursive: true })

loadUserEnvFile(path.join(userDataDir, '.env'))

process.env.FLASHCRAFT_DATA_DIR = dataDirectory
process.env.FLASHCRAFT_SERVE_STATIC = '1'
process.env.FLASHCRAFT_LOCAL_MODE = '1'
process.env.NODE_ENV = isDev ? 'development' : 'production'
process.env.PORT = process.env.PORT || '58231'

if (!isDev) {
  process.env.FLASHCRAFT_DIST_DIR = path.join(process.resourcesPath, 'app-dist')
}

function loadUserEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

let mainWindow = null
let serverInfo = null

async function bootServer() {
  const serverEntry = path.join(__dirname, '..', 'server', 'index.mjs')
  const { startServer } = await import(pathToFileURL(serverEntry).href)
  serverInfo = await startServer()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Flashcraft',
    backgroundColor: '#0f0f10',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const url = `http://localhost:${serverInfo.port}/`
  mainWindow.loadURL(url)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function buildMenu() {
  const template = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Open Data Folder',
          click: () => shell.openPath(dataDirectory),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(async () => {
  buildMenu()
  await bootServer()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
