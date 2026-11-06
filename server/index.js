import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import express from 'express'
import multer from 'multer'
import QRCode from 'qrcode'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(here, 'data')
const databasePath = process.env.VACATION_DB_PATH ?? path.join(dataDir, 'vacations.sqlite')
const storageDir = path.dirname(databasePath)
const uploadsDir = path.join(storageDir, 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'hr')),
    manager_id INTEGER REFERENCES users(id),
    mfa_secret TEXT,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    mfa_last_counter INTEGER NOT NULL DEFAULT -1
  );
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES users(id),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days INTEGER NOT NULL,
    leave_type TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('manager_pending', 'hr_pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    storage_name TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`)

const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name))
if (!userColumns.has('mfa_secret')) db.exec('ALTER TABLE users ADD COLUMN mfa_secret TEXT')
if (!userColumns.has('mfa_enabled')) db.exec('ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0')
if (!userColumns.has('mfa_last_counter')) db.exec('ALTER TABLE users ADD COLUMN mfa_last_counter INTEGER NOT NULL DEFAULT -1')

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

const verifyPassword = (password, stored) => {
  const [salt, expected] = stored.split(':')
  const actual = crypto.scryptSync(password, salt, 64)
  const expectedBuffer = Buffer.from(expected, 'hex')
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer)
}

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const encodeBase32 = (buffer) => {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += base32Alphabet[(value << (5 - bits)) & 31]
  return output
}

const decodeBase32 = (secret) => {
  let bits = 0
  let value = 0
  const output = []
  for (const character of secret.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '')) {
    const index = base32Alphabet.indexOf(character)
    if (index < 0) throw new Error('Invalid TOTP secret')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(output)
}

const totpCounterFor = (secret, counter) => {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(message).digest()
  const offset = digest[digest.length - 1] & 15
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255)
  return String(binary % 1_000_000).padStart(6, '0')
}

const matchingTotpCounter = (secret, code, lastCounter = -1) => {
  if (!/^\d{6}$/.test(String(code ?? ''))) return null
  const currentCounter = Math.floor(Date.now() / 30_000)
  for (const counter of [currentCounter - 1, currentCounter, currentCounter + 1]) {
    if (counter > lastCounter && totpCounterFor(secret, counter) === String(code)) return counter
  }
  return null
}

const createTotpSecret = () => encodeBase32(crypto.randomBytes(20))
const createOtpAuthUri = (secret, email) => {
  const label = encodeURIComponent(`Отпуск:${email}`)
  const issuer = encodeURIComponent('Отпуск HR')
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
}

const allowedUploads = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['text/plain', '.txt'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
])
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadsDir),
    filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${allowedUploads.get(file.mimetype)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, callback) => {
    if (!allowedUploads.has(file.mimetype)) return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname))
    callback(null, true)
  },
})

const removeUploadedFiles = (files = []) => {
  for (const file of files) fs.rm(file.path, { force: true }, () => undefined)
}

const ensureDemoUser = db.prepare(`
  INSERT INTO users (name, email, password_hash, role, manager_id)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(email) DO NOTHING
`)
const findUserId = db.prepare('SELECT id FROM users WHERE email = ?')
const seedDemoUsers = db.transaction(() => {
  ensureDemoUser.run('Дмитрий Соколов', 'manager@hr.local', hashPassword('Vacation2026!'), 'manager', null)
  ensureDemoUser.run('Мария Кузнецова', 'manager2@hr.local', hashPassword('Vacation2026!'), 'manager', null)
  const firstManager = findUserId.get('manager@hr.local').id
  const secondManager = findUserId.get('manager2@hr.local').id
  ensureDemoUser.run('Анна Волкова', 'employee@hr.local', hashPassword('Vacation2026!'), 'employee', firstManager)
  ensureDemoUser.run('Илья Смирнов', 'employee2@hr.local', hashPassword('Vacation2026!'), 'employee', firstManager)
  ensureDemoUser.run('София Орлова', 'employee3@hr.local', hashPassword('Vacation2026!'), 'employee', secondManager)
  ensureDemoUser.run('HR команда', 'hr@hr.local', hashPassword('Vacation2026!'), 'hr', null)
})
seedDemoUsers()

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '32kb' }))

const sessions = new Map()
const pendingLogins = new Map()
const cookieOptions = `Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
const getSessionUser = (req) => {
  const token = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('sid='))?.slice(4)
  const session = token ? sessions.get(token) : null
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token)
    return null
  }
  return db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(session.userId) ?? null
}

const requireAuth = (req, res, next) => {
  const user = getSessionUser(req)
  if (!user) return res.status(401).json({ error: 'Войдите в систему, чтобы продолжить.' })
  req.user = user
  next()
}

const weekdaysBetween = (start, end) => {
  let total = 0
  const cursor = new Date(`${start}T12:00:00Z`)
  const last = new Date(`${end}T12:00:00Z`)
  while (cursor <= last) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) total += 1
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return total
}

const buildRequest = (row) => ({
  ...row,
  attachments: db.prepare(`
    SELECT id, original_name, mime_type, size, created_at FROM attachments
    WHERE request_id = ? ORDER BY id
  `).all(row.id),
  history: db.prepare(`
    SELECT h.id, h.action, h.comment, h.created_at, u.name AS actor_name, u.role AS actor_role
    FROM history h JOIN users u ON u.id = h.actor_id
    WHERE h.request_id = ? ORDER BY h.id
  `).all(row.id),
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.post('/api/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const user = db.prepare('SELECT id, name, email, password_hash, role, mfa_secret, mfa_enabled FROM users WHERE email = ?').get(email)
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверная почта или пароль.' })
  }
  if (!user.mfa_enabled) {
    const secret = user.mfa_secret ?? createTotpSecret()
    if (!user.mfa_secret) db.prepare('UPDATE users SET mfa_secret = ? WHERE id = ?').run(secret, user.id)
    const challengeToken = crypto.randomBytes(32).toString('hex')
    pendingLogins.set(challengeToken, { userId: user.id, token: crypto.randomBytes(32).toString('hex'), expiresAt: Date.now() + 5 * 60_000 })
    return res.json({
      mfaRequired: true,
      mfaSetupRequired: true,
      challengeToken,
      secret,
      otpauthUrl: createOtpAuthUri(secret, user.email),
      qrDataUrl: await QRCode.toDataURL(createOtpAuthUri(secret, user.email), { width: 220, margin: 1 }),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })
  }
  const token = crypto.randomBytes(32).toString('hex')
  const challengeToken = crypto.randomBytes(32).toString('hex')
  pendingLogins.set(challengeToken, { userId: user.id, token, expiresAt: Date.now() + 5 * 60_000 })
  res.json({ mfaRequired: true, challengeToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } })
})

app.post('/api/login/mfa', (req, res) => {
  const challengeToken = String(req.body?.challengeToken ?? '')
  const challenge = pendingLogins.get(challengeToken)
  if (!challenge || challenge.expiresAt < Date.now()) {
    pendingLogins.delete(challengeToken)
    return res.status(401).json({ error: 'Срок проверки MFA истёк. Войдите ещё раз.' })
  }
  const user = db.prepare('SELECT id, name, email, role, mfa_secret, mfa_enabled, mfa_last_counter FROM users WHERE id = ?').get(challenge.userId)
  if (!user?.mfa_secret) return res.status(400).json({ error: 'Настройте приложение-аутентификатор.' })
  const counter = matchingTotpCounter(user.mfa_secret, req.body?.code, user.mfa_last_counter)
  if (counter === null) {
    challenge.attempts = (challenge.attempts ?? 0) + 1
    if (challenge.attempts >= 5) pendingLogins.delete(challengeToken)
    return res.status(401).json({ error: 'Неверный код MFA.' })
  }
  const finishLogin = db.transaction(() => {
    db.prepare('UPDATE users SET mfa_enabled = 1, mfa_last_counter = ? WHERE id = ?').run(counter, user.id)
    pendingLogins.delete(challengeToken)
    sessions.set(challenge.token, { userId: user.id, expiresAt: Date.now() + 1000 * 60 * 60 * 12 })
  })
  finishLogin()
  res.setHeader('Set-Cookie', `sid=${challenge.token}; ${cookieOptions}; Max-Age=43200`)
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } })
})

app.post('/api/mfa/setup', requireAuth, (req, res) => {
  const secret = createTotpSecret()
  db.prepare('UPDATE users SET mfa_secret = ?, mfa_enabled = 0 WHERE id = ?').run(secret, req.user.id)
  res.json({ secret, otpauthUrl: createOtpAuthUri(secret, req.user.email) })
})

app.post('/api/mfa/confirm', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, mfa_secret, mfa_last_counter FROM users WHERE id = ?').get(req.user.id)
  if (!user?.mfa_secret) return res.status(400).json({ error: 'Начните настройку приложения-аутентификатора.' })
  const counter = matchingTotpCounter(user.mfa_secret, req.body?.code, user.mfa_last_counter)
  if (counter === null) return res.status(400).json({ error: 'Неверный код MFA.' })
  db.prepare('UPDATE users SET mfa_enabled = 1, mfa_last_counter = ? WHERE id = ?').run(counter, req.user.id)
  res.json({ enabled: true })
})

app.post('/api/mfa/disable', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, password_hash, mfa_secret, mfa_last_counter FROM users WHERE id = ?').get(req.user.id)
  if (!user || !verifyPassword(String(req.body?.password ?? ''), user.password_hash)) {
    return res.status(401).json({ error: 'Неверный пароль.' })
  }
  const counter = matchingTotpCounter(user.mfa_secret, req.body?.code, user.mfa_last_counter)
  if (counter === null) return res.status(401).json({ error: 'Неверный код MFA.' })
  db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_last_counter = -1 WHERE id = ?').run(req.user.id)
  res.json({ enabled: false })
})

app.post('/api/logout', (req, res) => {
  const token = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('sid='))?.slice(4)
  if (token) sessions.delete(token)
  res.setHeader('Set-Cookie', `sid=; ${cookieOptions}; Max-Age=0`)
  res.status(204).end()
})

app.get('/api/me', (req, res) => {
  const user = getSessionUser(req)
  if (!user) return res.json({ user: null })
  const security = db.prepare('SELECT mfa_enabled FROM users WHERE id = ?').get(user.id)
  res.json({ user: { ...user, mfa_enabled: Boolean(security.mfa_enabled) } })
})

app.get('/api/requests', requireAuth, (req, res) => {
  let rows
  if (req.user.role === 'employee') {
    rows = db.prepare(`
      SELECT r.*, u.name AS employee_name FROM requests r
      JOIN users u ON u.id = r.employee_id WHERE r.employee_id = ? ORDER BY r.created_at DESC
    `).all(req.user.id)
  } else if (req.user.role === 'manager') {
    rows = db.prepare(`
      SELECT r.*, u.name AS employee_name FROM requests r
      JOIN users u ON u.id = r.employee_id
      WHERE u.manager_id = ? ORDER BY r.created_at DESC
    `).all(req.user.id)
  } else {
    rows = db.prepare(`
      SELECT r.*, u.name AS employee_name FROM requests r
      JOIN users u ON u.id = r.employee_id ORDER BY r.created_at DESC
    `).all()
  }
  res.json({ requests: rows.map(buildRequest) })
})

const findRequestForUser = (requestId, user) => {
  const row = db.prepare(`
    SELECT r.*, u.name AS employee_name, u.manager_id FROM requests r
    JOIN users u ON u.id = r.employee_id WHERE r.id = ?
  `).get(requestId)
  if (!row) return null
  const mayView = user.role === 'hr'
    || user.role === 'employee' && row.employee_id === user.id
    || user.role === 'manager' && row.manager_id === user.id
  return mayView ? row : null
}

app.get('/api/requests/:id', requireAuth, (req, res) => {
  const row = findRequestForUser(Number(req.params.id), req.user)
  if (!row) return res.status(404).json({ error: 'Заявление не найдено.' })
  res.json({ request: buildRequest(row) })
})

app.get('/api/requests/:id/attachments/:attachmentId', requireAuth, (req, res) => {
  const row = findRequestForUser(Number(req.params.id), req.user)
  if (!row) return res.status(404).json({ error: 'Заявление не найдено.' })
  const attachment = db.prepare('SELECT * FROM attachments WHERE id = ? AND request_id = ?').get(Number(req.params.attachmentId), row.id)
  if (!attachment) return res.status(404).json({ error: 'Файл не найден.' })
  const fullPath = path.resolve(uploadsDir, attachment.storage_name)
  if (!fullPath.startsWith(`${path.resolve(uploadsDir)}${path.sep}`) || !fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Файл не найден.' })
  }
  res.download(fullPath, attachment.original_name)
})

app.post('/api/requests', requireAuth, upload.array('attachments', 5), (req, res) => {
  if (req.user.role !== 'employee') {
    removeUploadedFiles(req.files ?? [])
    return res.status(403).json({ error: 'Заявление может подать только сотрудник.' })
  }
  const { startDate, endDate, leaveType, note = '' } = req.body ?? {}
  const files = req.files ?? []
  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  if (!datePattern.test(startDate ?? '') || !datePattern.test(endDate ?? '') || startDate > endDate) {
    removeUploadedFiles(files)
    return res.status(400).json({ error: 'Проверьте даты отпуска.' })
  }
  if (startDate < new Date().toISOString().slice(0, 10)) {
    removeUploadedFiles(files)
    return res.status(400).json({ error: 'Дата начала не может быть в прошлом.' })
  }
  const allowedTypes = ['Ежегодный отпуск', 'За свой счёт', 'Другое']
  if (!allowedTypes.includes(leaveType)) {
    removeUploadedFiles(files)
    return res.status(400).json({ error: 'Выберите тип отсутствия.' })
  }
  const days = weekdaysBetween(startDate, endDate)
  if (!days) {
    removeUploadedFiles(files)
    return res.status(400).json({ error: 'В выбранном диапазоне нет рабочих дней.' })
  }
  try {
    const createWithAttachments = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO requests (employee_id, start_date, end_date, days, leave_type, note, status)
        VALUES (?, ?, ?, ?, ?, ?, 'manager_pending')
      `).run(req.user.id, startDate, endDate, days, leaveType, String(note).trim().slice(0, 2000))
      const requestId = Number(result.lastInsertRowid)
      db.prepare('INSERT INTO history (request_id, actor_id, action, comment) VALUES (?, ?, ?, ?)')
        .run(requestId, req.user.id, 'submitted', 'Заявление отправлено руководителю')
      const insertAttachment = db.prepare(`
        INSERT INTO attachments (request_id, storage_name, original_name, mime_type, size)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const file of files) {
        insertAttachment.run(requestId, path.basename(file.filename), path.basename(file.originalname).slice(0, 180), file.mimetype, file.size)
      }
      return requestId
    })
    const requestId = createWithAttachments()
    const row = db.prepare(`SELECT r.*, u.name AS employee_name FROM requests r JOIN users u ON u.id = r.employee_id WHERE r.id = ?`).get(requestId)
    res.status(201).json({ request: buildRequest(row) })
  } catch (error) {
    removeUploadedFiles(files)
    throw error
  }
})

app.post('/api/requests/:id/decision', requireAuth, (req, res) => {
  const requestId = Number(req.params.id)
  const { decision, comment = '' } = req.body ?? {}
  const request = db.prepare(`
    SELECT r.*, u.manager_id FROM requests r JOIN users u ON u.id = r.employee_id WHERE r.id = ?
  `).get(requestId)
  if (!request) return res.status(404).json({ error: 'Заявление не найдено.' })
  if (req.user.role === 'manager' && req.user.id !== request.manager_id) {
    return res.status(404).json({ error: 'Заявление не найдено.' })
  }
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Неизвестное решение.' })
  const cleanComment = String(comment).trim().slice(0, 1000)
  if (decision === 'reject' && !cleanComment) return res.status(400).json({ error: 'Для отказа укажите причину.' })

  let status
  let action
  if (req.user.role === 'manager' && req.user.id === request.manager_id && request.status === 'manager_pending') {
    status = decision === 'approve' ? 'hr_pending' : 'rejected'
    action = decision === 'approve' ? 'manager_approved' : 'rejected'
  } else if (req.user.role === 'hr' && request.status === 'hr_pending') {
    status = decision === 'approve' ? 'approved' : 'rejected'
    action = decision === 'approve' ? 'hr_approved' : 'rejected'
  } else {
    return res.status(403).json({ error: 'У вас нет прав на это решение или этап уже завершён.' })
  }

  const saveDecision = db.transaction(() => {
    db.prepare('UPDATE requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, requestId)
    db.prepare('INSERT INTO history (request_id, actor_id, action, comment) VALUES (?, ?, ?, ?)')
      .run(requestId, req.user.id, action, cleanComment || (status === 'hr_pending' ? 'Передано на утверждение HR' : ''))
  })
  saveDecision()
  const row = db.prepare(`
    SELECT r.*, u.name AS employee_name FROM requests r JOIN users u ON u.id = r.employee_id WHERE r.id = ?
  `).get(requestId)
  res.json({ request: buildRequest(row) })
})

app.use((error, req, res, _next) => {
  console.error(error)
  if (error instanceof multer.MulterError) {
    removeUploadedFiles(req.files ?? [])
    return res.status(400).json({ error: 'Файл не поддерживается или превышен лимит загрузки.' })
  }
  res.status(500).json({ error: 'Внутренняя ошибка сервера.' })
})

const port = Number(process.env.API_PORT ?? 3001)
const host = process.env.API_HOST ?? '127.0.0.1'
if (process.env.NODE_ENV === 'production') {
  const webRoot = path.resolve(here, '..', 'dist')
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Маршрут API не найден.' }))
  app.use(express.static(webRoot))
  app.get(/.*/, (_req, res) => res.sendFile(path.join(webRoot, 'index.html')))
}

app.listen(port, host, () => console.log(`HR API is running on http://${host}:${port}`))
