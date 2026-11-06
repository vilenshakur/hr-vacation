const { app, BrowserWindow, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

let mainWindow

async function startApplication() {
  process.env.API_PORT = '3001'
  if (app.isPackaged) {
    process.env.NODE_ENV = 'production'
    process.env.VACATION_DB_PATH = path.join(app.getPath('userData'), 'vacations.sqlite')
  }

  await import('../server/index.js')

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 360,
    minHeight: 620,
    show: false,
    backgroundColor: '#f4f6f2',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })

  const appUrl = app.isPackaged
    ? 'http://127.0.0.1:3001'
    : 'http://127.0.0.1:5173'
  await mainWindow.loadURL(appUrl)
}

const hasSingleInstance = app.requestSingleInstanceLock()
if (!hasSingleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(startApplication).catch((error) => {
    console.error('Unable to start Отпуск:', error)
    const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)
    try {
      const logPath = path.join(app.getPath('userData'), 'startup-error.log')
      fs.writeFileSync(logPath, message, 'utf8')
      dialog.showErrorBox('Не удалось запустить приложение', `${message}\n\nПодробности: ${logPath}`)
    } catch (loggingError) {
      console.error('Unable to write startup error log:', loggingError)
    }
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
