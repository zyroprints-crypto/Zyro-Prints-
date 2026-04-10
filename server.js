require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const Database   = require('better-sqlite3');
const nodemailer = require('nodemailer');
const path       = require('path');
const multer     = require('multer');
const upload     = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'zyroprints_secret_2025';

// ── MIDDLEWARE ──
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.options('*', cors());
app.use(express.json());

// ── DATABASE SETUP ──
const db = new Database(path.join(__dirname, 'zyroprints.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id       TEXT UNIQUE NOT NULL,
    name           TEXT NOT NULL,
    phone          TEXT NOT NULL,
    email          TEXT,
    product        TEXT NOT NULL,
    quantity       TEXT,
    description    TEXT,
    address        TEXT,
    status         TEXT DEFAULT 'pending',
    payment_method TEXT DEFAULT 'upi',
    payment_status TEXT DEFAULT 'pending',
    razorpay_id    TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admins (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Create default admin (username: mugesh, password: zyro@2025)
const existingAdmin = db.prepare('SELECT * FROM admins WHERE username = ?').get('mugesh');
if (!existingAdmin) {
  const hashed = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'mugesh@2005', 10);
  db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run('mugesh', hashed);
  console.log('✅ Default admin created');
} else {
  // Update password if ADMIN_PASSWORD env changed
  const newPwd = process.env.ADMIN_PASSWORD || 'mugesh@2005';
  if (!bcrypt.compareSync(newPwd, existingAdmin.password)) {
    const hashed = bcrypt.hashSync(newPwd, 10);
    db.prepare('UPDATE admins SET password = ? WHERE username = ?').run(hashed, 'mugesh');
    console.log('✅ Admin password updated');
  }
}

// ── EMAIL SETUP ──
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'zyroprints@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD || ''
  }
});

async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({ from: '"Zyro Prints" <zyroprints@gmail.com>', to, subject, html });
    console.log('Email sent to:', to);
  } catch (e) { console.error('Email error:', e.message); }
}

async function sendEmailWithAttachment(to, subject, attachments, html) {
  try {
    await transporter.sendMail({
      from: '"Zyro Prints" <zyroprints@gmail.com>',
      to, subject, html,
      attachments: attachments || []
    });
    console.log('Email sent to:', to);
  } catch (e) { console.error('Email error:', e.message); }
}

// ── AUTH MIDDLEWARE ──
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ══════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════

// ── HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({ status: 'Zyro Prints API is running 🚀', time: new Date() });
});

// ── ADMIN LOGIN ──
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, admin.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, username: admin.username });
});

// ── PLACE ORDER (Public) ──
app.post('/api/orders', upload.single('design_file'), async (req, res) => {
  const { name, phone, email, product, quantity, description, address } = req.body;

  if (!name || !phone || !product) {
    return res.status(400).json({ error: 'Name, phone, and product are required' });
  }

  const orderId = 'ZP-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-4);

  try {
    const payment_method = req.body.payment_method || 'upi';
    db.prepare(`
      INSERT INTO orders (order_id, name, phone, email, product, quantity, description, address, status, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(orderId, name, phone, email || '', product, quantity || '', description || '', address || '', payment_method);

    // Send email with optional file attachment
    const attachments = [];
    if (req.file) {
      attachments.push({
        filename: req.file.originalname,
        content: req.file.buffer,
        contentType: req.file.mimetype
      });
    }

    // Email to Zyro Prints owner
    await sendEmailWithAttachment(
      'zyroprints@gmail.com',
      `🛒 New Order — ${orderId} — ${name}`,
      attachments,
      `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#E8441A">New Order Received!</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Order ID</td><td style="padding:8px;border:1px solid #eee">${orderId}</td></tr>
            <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Name</td><td style="padding:8px;border:1px solid #eee">${name}</td></tr>
            <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Phone</td><td style="padding:8px;border:1px solid #eee">${phone}</td></tr>
            <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Email</td><td style="padding:8px;border:1px solid #eee">${email || 'Not provided'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Product</td><td style="padding:8px;border:1px solid #eee">${product}</td></tr>
            <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Quantity</td><td style="padding:8px;border:1px solid #eee">${quantity || 'Not specified'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Address</td><td style="padding:8px;border:1px solid #eee">${address || 'Not provided'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Instructions</td><td style="padding:8px;border:1px solid #eee">${description || 'None'}</td></tr>
          </table>
          <p style="margin-top:20px;color:#888">Login to your admin panel to manage this order.</p>
        </div>
      `
    );

    // Confirmation email to customer
    if (email) {
      await sendEmail(
        email,
        `Order Confirmed — ${orderId} | Zyro Prints`,
        `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#E8441A">Thank you for your order, ${name}! 🎉</h2>
            <p>Your order has been received. We'll contact you on <strong>${phone}</strong> to confirm the details.</p>
            <div style="background:#f4f4f0;padding:20px;border-radius:8px;margin:20px 0">
              <p><strong>Order ID:</strong> ${orderId}</p>
              <p><strong>Product:</strong> ${product}</p>
              <p><strong>Quantity:</strong> ${quantity || 'TBD'}</p>
            </div>
            <p>Track your order at <a href="https://zyroprints.com/track">zyroprints.com/track</a></p>
            <p style="color:#888">— Zyro Prints, Kodambakkam Chennai | +91 78456 92915</p>
          </div>
        `
      );
    }

    res.json({ success: true, order_id: orderId, message: 'Order placed successfully!' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

// ── TRACK ORDER (Public) ──
app.get('/api/orders/track/:orderId', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  // don't expose email/address publicly
  const { email, address, ...safe } = order;
  res.json({ success: true, order: safe });
});

// ── GET ALL ORDERS (Admin only) ──
app.get('/api/admin/orders', authMiddleware, (req, res) => {
  const { status, search } = req.query;
  let query = 'SELECT * FROM orders';
  const params = [];
  const conditions = [];

  if (status && status !== 'all') { conditions.push('status = ?'); params.push(status); }
  if (search) { conditions.push('(name LIKE ? OR order_id LIKE ? OR phone LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC';

  const orders = db.prepare(query).all(...params);
  const stats = {
    total:     db.prepare("SELECT COUNT(*) as c FROM orders").get().c,
    pending:   db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='pending'").get().c,
    printing:  db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='printing'").get().c,
    ready:     db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='ready'").get().c,
    delivered: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='delivered'").get().c,
  };
  res.json({ success: true, orders, stats });
});

// ── UPDATE ORDER STATUS (Admin only) ──
app.patch('/api/admin/orders/:orderId/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'printing', 'ready', 'delivered', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?')
    .run(status, req.params.orderId);

  // Notify customer by email when status changes
  const statusMessages = {
    confirmed:  { label: 'Order Confirmed ✅',      msg: 'Your order has been confirmed and will go for printing soon.' },
    printing:   { label: 'Now Printing 🖨️',         msg: 'Your order is currently being printed!' },
    ready:      { label: 'Ready for Pickup/Delivery 📦', msg: 'Your order is ready! We will deliver it shortly.' },
    delivered:  { label: 'Delivered 🎉',            msg: 'Your order has been delivered. Thank you for choosing Zyro Prints!' },
    cancelled:  { label: 'Order Cancelled ❌',      msg: 'Your order has been cancelled. Please contact us for more info.' },
  };

  if (order.email && statusMessages[status]) {
    const { label, msg } = statusMessages[status];
    await sendEmail(
      order.email,
      `${label} — Order ${order.order_id} | Zyro Prints`,
      `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#E8441A">${label}</h2>
          <p>Hi ${order.name},</p>
          <p>${msg}</p>
          <div style="background:#f4f4f0;padding:20px;border-radius:8px;margin:20px 0">
            <p><strong>Order ID:</strong> ${order.order_id}</p>
            <p><strong>Product:</strong> ${order.product}</p>
            <p><strong>New Status:</strong> ${status.toUpperCase()}</p>
          </div>
          <p>Questions? Call or WhatsApp us: <a href="https://wa.me/917845692915">+91 78456 92915</a></p>
          <p style="color:#888">— Zyro Prints, Kodambakkam Chennai</p>
        </div>
      `
    );
  }

  res.json({ success: true, message: `Order status updated to ${status}` });
});

// ── DELETE ORDER (Admin only) ──
app.delete('/api/admin/orders/:orderId', authMiddleware, (req, res) => {
  const result = db.prepare('DELETE FROM orders WHERE order_id = ?').run(req.params.orderId);
  if (result.changes === 0) return res.status(404).json({ error: 'Order not found' });
  res.json({ success: true, message: 'Order deleted' });
});

// ── CHANGE ADMIN PASSWORD ──
app.post('/api/admin/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!bcrypt.compareSync(oldPassword, admin.password)) {
    return res.status(401).json({ error: 'Old password is incorrect' });
  }
  const hashed = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admins SET password = ? WHERE id = ?').run(hashed, req.admin.id);
  res.json({ success: true, message: 'Password changed successfully' });
});

// ── RAZORPAY — Create Order ──
app.post('/api/payment/create-order', async (req, res) => {
  const { amount, orderId } = req.body;
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(500).json({ error: 'Razorpay not configured — add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to Railway Variables' });
  }

  // Ensure amount is valid (min ₹1 = 100 paise)
  const amountPaise = Math.max(Math.round((parseFloat(amount) || 1) * 100), 100);

  try {
    const https = require('https');
    const auth = Buffer.from(keyId + ':' + keySecret).toString('base64');

    const postData = JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt: orderId || ('ZP-' + Date.now()),
    });

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.razorpay.com',
        path: '/v1/orders',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + auth,
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      const req2 = https.request(options, (r) => {
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error('Invalid response: ' + data)); }
        });
      });
      req2.on('error', reject);
      req2.write(postData);
      req2.end();
    });

    if (result.id) {
      res.json({ success: true, razorpay_order_id: result.id, amount: result.amount, currency: result.currency, key_id: keyId });
    } else {
      console.error('Razorpay error:', result);
      res.status(500).json({ error: 'Failed to create Razorpay order', details: result.error || result });
    }
  } catch(e) {
    console.error('Razorpay exception:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── RAZORPAY — Verify Payment ──
app.post('/api/payment/verify', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = req.body;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keySecret) {
    return res.status(500).json({ success: false, error: 'Razorpay secret not configured' });
  }

  const crypto = require('crypto');
  const expectedSig = crypto
    .createHmac('sha256', keySecret)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');

  if (expectedSig === razorpay_signature) {
    try {
      db.prepare('UPDATE orders SET payment_status = ?, razorpay_id = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?')
        .run('paid', razorpay_payment_id, order_id || 'unknown');
    } catch(e) {
      console.log('DB update note:', e.message);
    }
    res.json({ success: true, message: 'Payment verified!' });
  } else {
    res.status(400).json({ success: false, error: 'Payment signature mismatch' });
  }
});

// ── START SERVER ──
app.listen(PORT, () => {
  console.log(`🚀 Zyro Prints backend running on port ${PORT}`);
});
