# ติดตั้ง Pre-Booking: Supabase · Google · Cloudflare

ทำตามลำดับ 1 → 5 ใช้เวลาประมาณ 45–60 นาที

ระหว่างทำ ให้เปิดไฟล์โน้ตไว้จดค่าต่อไปนี้:

| ค่า | ได้จากขั้นที่ |
|---|---|
| Supabase Project URL (`https://xxxx.supabase.co`) | 1.6 |
| Supabase anon / publishable key | 1.6 |
| Google Client ID และ Client secret | 2.4 |
| URL ของแอปบน Cloudflare (`https://pre-booking.xxx.workers.dev`) | 4.5 |

> หมายเหตุ: ชื่อเมนูในหน้า dashboard ของ Supabase, Google และ Cloudflare อาจเปลี่ยนไปเล็กน้อยตามเวอร์ชัน ถ้าหาไม่เจอให้ใช้ช่องค้นหาในหน้านั้น

---

## 1. Supabase (ฐานข้อมูล + ระบบ login)

1. **สร้างโปรเจกต์:** เข้า https://supabase.com → Sign in → **New project**
   - Name: `pre-booking`
   - Database password: ตั้งรหัสที่เดายาก **และจดเก็บไว้**
   - Region: **Southeast Asia (Singapore)**
   - Plan: Free ใช้ทดลองได้ (ข้อจำกัด: ไม่มีการกู้คืนข้อมูลย้อนหลัง และโปรเจกต์จะถูกพักถ้าไม่มีการใช้งาน 7 วัน → ใช้งานจริงแนะนำ Pro)
2. **เปิด pg_cron:** เมนูซ้าย **Database → Extensions** → ค้นหา `pg_cron` → เปิด (Enable)
3. **สร้างตารางทั้งหมด (คัดลอกวางครั้งเดียว):**
   1. เปิดไฟล์ https://github.com/ppcpre/Pre-Booking/blob/claude/awesome-goodall-t65b28/supabase/setup-all.sql
   2. กดปุ่ม **Copy raw file** (ไอคอนสี่เหลี่ยมซ้อนกัน มุมขวาบนของกล่องโค้ด)
   3. Supabase เมนูซ้าย **SQL Editor** → **New query** (หรือ "+")
   4. คลิกในช่องว่าง → วาง (Ctrl+V / ⌘V) → กด **Run** (มุมขวาล่าง หรือ Ctrl+Enter)
   5. ถ้า Supabase เตือนว่ามีคำสั่งที่ลบ/แก้ข้อมูล ให้กด **Run this query** ยืนยัน
   6. ต้องขึ้น **"Success. No rows returned"** — ถ้าขึ้น error ให้ส่งข้อความมาให้ผม (ไฟล์นี้รันแบบทั้งหมดหรือไม่มีเลย ถ้า error จะไม่มีอะไรค้างครึ่งๆ กลางๆ แก้แล้วรันใหม่ได้เลย)
   > ไฟล์นี้คือ 7 ไฟล์ใน `supabase/migrations/` ต่อกันตามลำดับ ถ้าอยากรันทีละไฟล์ก็ทำแบบเดียวกันทีละไฟล์ได้
4. **ใส่ตัวเองเป็น Admin คนแรก:** New query → วาง SQL ด้านล่าง → **เปลี่ยนอีเมลเป็น Gmail ของคุณ** → Run
   ```sql
   insert into public.team_members (email, full_name, role)
   values ('you@gmail.com', 'Your Name', 'ADMIN')
   on conflict (email) do update set role = 'ADMIN', is_active = true;
   ```
5. **ตรวจ Storage:** เมนูซ้าย **Storage** ต้องเห็น bucket `property-photos` และ `meter-photos` (เป็น Private ทั้งคู่)
6. **คัดลอกค่าที่ต้องใช้:** ไอคอนเฟือง **Project Settings → API** (หรือ **Data API / API Keys**)
   - **Project URL** → จดไว้
   - **anon public** key (บางโปรเจกต์เรียก **publishable key**) → จดไว้
   - ห้ามใช้ `service_role` / secret key ในแอปนี้

## 2. Google Cloud (ปุ่ม "Continue with Google")

1. เข้า https://console.cloud.google.com → แถบบนกดเลือกโปรเจกต์ → **New project** → ตั้งชื่อ `Pre-Booking` → Create แล้วเลือกโปรเจกต์นี้
2. **ตั้งค่าหน้าขอสิทธิ์:** ค้นหาเมนู **Google Auth Platform** (หรือ **APIs & Services → OAuth consent screen**) → **Get started**
   - App name: `Pre-Booking`
   - User support email: อีเมลของคุณ
   - Audience: **External**
   - Contact email: อีเมลของคุณ → ยอมรับเงื่อนไข → Create
3. **เปิดให้ทุก Gmail ใช้ได้:** เมนู **Audience** → กด **Publish app**
   - ถ้ายังเป็น "Testing" จะ login ได้เฉพาะอีเมลที่เพิ่มใน Test users
   - แอปนี้ขอแค่ชื่อและอีเมล (`openid`, `email`, `profile`) จึงไม่ต้องรอ Google ตรวจสอบ
4. **สร้าง Client:** เมนู **Clients** (หรือ **Credentials → Create credentials → OAuth client ID**)
   - Application type: **Web application**
   - Name: `Pre-Booking web`
   - **Authorized redirect URIs** → Add URI:
     `https://<project-ref>.supabase.co/auth/v1/callback`
     (คัดลอกค่าที่ถูกต้องได้จาก Supabase ในขั้น 3.1 ช่อง "Callback URL")
   - Create → จด **Client ID** และ **Client secret**

## 3. ตั้งค่า Login ใน Supabase

1. **Authentication → Sign In / Providers** (หรือ **Providers**) → **Google** → Enable
   - วาง **Client ID** และ **Client secret** จากขั้น 2.4 → Save
   - ช่อง Callback URL ในหน้านี้คือค่าที่ต้องใส่ใน Google (ขั้น 2.4)
2. ในหน้า Providers เดียวกัน → **Email** → ปิด (Disable) หรือปิด "Allow new users to sign up" เพราะแอปนี้ใช้ Google อย่างเดียว
3. **Authentication → Hooks** → **Add hook** → **Before User Created**
   - Hook type: **Postgres** → Schema: `public` → Function: `hook_before_user_created` → Create
   - ผล: เฉพาะอีเมลที่อยู่ในหน้า Team เท่านั้นที่สร้างบัญชีได้
4. **Authentication → URL Configuration**
   - **Site URL:** ใส่ `http://localhost:3000` ไปก่อน (หลังขั้น 4 ค่อยเปลี่ยนเป็น URL ของ Cloudflare)
   - **Redirect URLs** → Add:
     - `http://localhost:3000/auth/callback`
     - (หลังขั้น 4) `https://pre-booking.xxx.workers.dev/auth/callback`
     - (ถ้ามีโดเมน) `https://your-domain.com/auth/callback`

## 4. Cloudflare (ขึ้นเว็บจริง)

ทำบนคอมของคุณ (ต้องมี Node.js 20 ขึ้นไป และ Git)

1. สมัคร / login ที่ https://dash.cloudflare.com
   - แผนฟรีใช้ทดลองได้ ใช้งานจริงแนะนำ **Workers Paid (~5 USD/เดือน)** เพราะแผนฟรีจำกัดเวลาประมวลผลต่อหน้า
2. ดึงโค้ด:
   ```bash
   git clone https://github.com/ppcpre/Pre-Booking.git
   cd Pre-Booking
   git checkout claude/awesome-goodall-t65b28
   npm install
   ```
3. ใส่ค่า Supabase (ต้องใส่ **2 ที่**):
   - สร้างไฟล์ `.env.local` (คัดลอกจาก `.env.example`) แล้วใส่ค่า:
     ```
     NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
     NEXT_PUBLIC_SUPABASE_ANON_KEY=ค่า anon key
     ```
   - เปิด `wrangler.jsonc` → แก้ค่าใน `"vars"` เป็นค่าเดียวกัน
4. **ลองบนเครื่องก่อน (แนะนำ):** `npm run dev` → เปิด http://localhost:3000 → กด Continue with Google ด้วย Gmail ที่ใส่ไว้ในขั้น 1.4 → ต้องเข้าหน้า Overview ได้
5. **Deploy:**
   ```bash
   npx wrangler login     # เปิดเบราว์เซอร์ให้ยืนยันบัญชี Cloudflare
   npm run deploy
   ```
   - เมื่อเสร็จจะได้ URL เช่น `https://pre-booking.<your-subdomain>.workers.dev` → จดไว้
6. กลับไปที่ **Supabase → Authentication → URL Configuration**
   - เปลี่ยน **Site URL** เป็น URL จากขั้น 4.5
   - เพิ่ม `https://pre-booking.<your-subdomain>.workers.dev/auth/callback` ใน Redirect URLs
7. **(ถ้ามีโดเมน)** โดเมนต้องอยู่ใน Cloudflare DNS ก่อน → **Workers & Pages → pre-booking → Settings → Domains & Routes → Add → Custom domain** → ใส่ เช่น `app.your-domain.com` → แล้วเพิ่ม `https://app.your-domain.com/auth/callback` ใน Supabase Redirect URLs และเปลี่ยน Site URL เป็นโดเมนนี้

> ทางเลือก: ให้ deploy อัตโนมัติทุกครั้งที่ push โค้ด → **Workers & Pages → pre-booking → Settings → Build** → เชื่อม GitHub repo
> - Build command: `npx opennextjs-cloudflare build`
> - Deploy command: `npx wrangler deploy`
> - ใส่ `NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_SUPABASE_ANON_KEY` ใน Build variables

## 5. ตรวจว่าใช้งานได้

1. เปิด URL ของแอป → **Continue with Google** ด้วย Gmail ของคุณ → เห็นหน้า Overview
2. ไอคอนเฟือง → **Team** → เพิ่ม Gmail ของพนักงาน 1 คน → ให้เขาลอง login
3. ไอคอนเฟือง → **Business** → ใส่ชื่อ ที่อยู่ เลขผู้เสียภาษี
4. **Add property** → ทำครบ 6 ขั้น (อัปโหลดรูป, ประเภทห้อง, ห้อง, ราคา, ค่าน้ำไฟ, พนักงาน) → **Open for bookings**
5. เข้าที่พัก → **New booking** รายวัน 1 รายการ → **Take payment** → ต้องได้ใบเสร็จ
6. บนมือถือ: เปิด URL ใน Chrome (Android) หรือ Safari (iPhone) → เมนูโปรไฟล์ → **Install app**

## 6. อัปเดตระบบครั้งต่อไป

เมื่อมีไฟล์ SQL ใหม่ใน `supabase/migrations/` (ไฟล์ที่ชื่อขึ้นต้นด้วยวันที่ใหม่กว่าที่เคยรัน):

1. Supabase → **SQL Editor → New query** → วางเนื้อหา **เฉพาะไฟล์ใหม่** → **Run** (ห้ามรัน `setup-all.sql` ซ้ำบนฐานข้อมูลที่ใช้งานอยู่)
2. บนคอม: `git pull` → `npm install` → `npm run deploy`

| ไฟล์ | เพิ่มอะไร |
|---|---|
| `20261030000100_backdated_bookings.sql` | บันทึกการจองย้อนหลังได้ |
| `20261031000100_corrections.sql` | แก้ข้อมูลย้อนหลัง (วันพัก/ห้อง, สัญญารายปี, ค่าใช้จ่าย, การชำระเงิน, สถานะ, เลขมิเตอร์) |

## ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| Google ขึ้น `redirect_uri_mismatch` | Redirect URI ใน Google (ขั้น 2.4) ไม่ตรงกับ Callback URL ของ Supabase ทุกตัวอักษร |
| Login แล้วขึ้น "This Google account isn't on the team" | อีเมลยังไม่อยู่ในหน้า Team / ขั้น 1.4 หรือถูกปิดใช้งาน |
| Login แล้วเด้งกลับหน้า Sign in ไม่มีข้อความ | ยังไม่ได้เพิ่ม `.../auth/callback` ของ URL นั้นใน Supabase Redirect URLs (ขั้น 3.4 / 4.6) |
| Google แจ้งว่าแอปยังไม่ผ่านการตรวจสอบ / ห้ามเข้า | ยังไม่ได้กด Publish app (ขั้น 2.3) |
| Deploy แล้วหน้าเว็บ error เรื่อง Supabase URL | ไม่ได้ใส่ค่าใน `.env.local` ก่อน `npm run deploy` (ค่า `NEXT_PUBLIC_*` ถูกฝังตอน build) |
| รัน SQL ไฟล์ใดไฟล์หนึ่งแล้ว error | รันไฟล์ก่อนหน้าไม่ครบ หรือยังไม่เปิด pg_cron (ไฟล์ที่ 4) → ส่งข้อความ error มาให้ผมดูได้ |
| การจองที่ไม่จ่ายเงินไม่ถูกปล่อยห้อง | pg_cron ยังไม่ทำงาน → ตรวจใน **Integrations / Database → Cron** ว่ามี job `expire-holds` |
