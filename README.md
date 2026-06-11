# neOwn Location Dashboard

Live dashboard for neOwn order data, connected to Google Sheets.

## Deploy to Vercel (5 minutes)

### Step 1 — Push to GitHub
1. Create a new repo on github.com (e.g. `neown-dashboard`)
2. In your terminal:
```bash
cd neown-location-dashboard
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/YOUR_USERNAME/neown-dashboard.git
git push -u origin main
```

### Step 2 — Deploy on Vercel
1. Go to vercel.com → New Project
2. Import your GitHub repo
3. Click Deploy (no config needed — vercel.json handles it)
4. Your dashboard is live at `https://neown-dashboard.vercel.app`

## Connect your Google Sheet
1. Open your Google Sheet
2. Share → Change to "Anyone with the link" → Viewer → Copy link
3. Paste the URL into the dashboard
4. Enter your sheet tab names (default: Sheet1 / Sheet2)
5. Click Load data

## Sheet column requirements
**Orders sheet:** ID, Order No, Email, Phone, Total Price, Created At, Shipping State, Shipping City, Shipping Pincode, Line Items, Customer Type, Discount Code

**Pincode sheet:** pincode, district, statename (standard India pincode master)
