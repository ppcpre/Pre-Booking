# Pre-Booking — Screen Design (v0.2, Approved — wireframe)

อ้างอิง: `docs/01-functional-design.md` (v1.0 Approved) · รหัสฟังก์ชัน (M5-01 ฯลฯ) อ้างตามเอกสารนั้น

- **ภาษา UI:** English ทั้งหมด (ข้อความในเอกสารนี้อธิบายเป็นภาษาไทย ส่วน label บนหน้าจอเป็นภาษาอังกฤษ)
- **โหมด:** `Daily` (จ่ายเต็มก่อนเข้าพัก) และ `Yearly` (จ่ายรายเดือน)
- **Wireframe แบบภาพ:** `docs/wireframes/index.html`
- **ผู้ใช้:** พนักงานบริษัทเท่านั้น (Admin / Manager / Front desk / Accountant)
- **อุปกรณ์:** ออกแบบสำหรับ Desktop/Laptop เป็นหลัก · Tablet ใช้ได้ทุกหน้า · **หน้าจดมิเตอร์และ Check-in/out ใช้บนมือถือได้ดี**

---

## 1. Design System

| หัวข้อ | เลือกใช้ | เหตุผล |
|---|---|---|
| UI components | **shadcn/ui** (Radix + Tailwind CSS) | โค้ดอยู่ในโปรเจกต์เอง ปรับแต่งได้, accessible, ใช้กับ Cloudflare Workers ได้ |
| Icons | lucide-react | มากับ shadcn/ui |
| Tables | TanStack Table | เรียง/กรอง/แบ่งหน้า |
| Forms | React Hook Form + Zod | ใช้ schema เดียวกับฝั่ง server |
| Date picker | react-day-picker (shadcn Calendar) | เลือกช่วงวันที่ |
| ฟอนต์ | Inter | |
| ธีม | Light (Dark เฟส 2) | |

### 1.1 สีสถานะ (ใช้ทั้งระบบ)

| ประเภท | สถานะ → สี |
|---|---|
| **Booking** | Hold = amber · Confirmed = blue · Checked-in = green · Checked-out = slate · Closed = gray · Cancelled / Expired / No-show = red (ตัวอักษรขีดฆ่า) |
| **Charge period** | Upcoming = gray · Due = sky · Partial = yellow · Overdue = red · Paid = green · Waived = purple · Cancelled = gray ขีดฆ่า |
| **Mode** | Daily = teal badge `D` · Yearly = indigo badge `Y` |
| **Block** | ลายทางสีเทา |

### 1.2 รูปแบบข้อมูล
- เงิน: `฿12,500.00` (ตารางจัดชิดขวา)
- วันที่: `26 Oct 2026` · ช่วงวันที่: `26–29 Oct 2026 · 3 nights`
- เวลา: 24 ชม. `14:00` (เวลาไทย)

---

## 2. Layout หลัก

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ☰ Pre-Booking   [ Property: Sukhumvit Residence ▾ ]   🔍 Search (⌘K)    🔔3  👤 │
├──────────────┬────────────────────────────────────────────────────────────────┤
│ ▣ Dashboard  │                                                                │
│ ▦ Calendar   │                                                                │
│ ▤ Bookings   │                  เนื้อหาของหน้า                                   │
│ ▥ Leases     │                                                                │
│ ฿ Payments   │                                                                │
│ ⚡ Meters     │                                                                │
│ 🗎 Documents  │                                                                │
│ 👥 Guests     │                                                                │
│ 📊 Reports    │                                                                │
│ ──────────── │                                                                │
│ ⚙ Settings   │                                                                │
└──────────────┴────────────────────────────────────────────────────────────────┘
```

- **Property switcher** (M2-01a): รายการที่พักที่ผู้ใช้มีสิทธิ์ + `All properties` (เฉพาะ Dashboard, Bookings, Payments, Reports) · จำค่าล่าสุดไว้
- **Global search (⌘K):** ค้นหาเลขการจอง, ชื่อผู้เข้าพัก, เบอร์โทร, เลขห้อง, เลขเอกสาร
- **🔔 Notifications** (M11-02): dropdown รายการแจ้งเตือน + "Mark all as read"
- **+ New booking** ปุ่มลอยมุมขวาบนของทุกหน้า (ยกเว้น Settings)
- เมนูที่ไม่มีสิทธิ์จะถูกซ่อน (ดูหัวข้อ 6)
- Mobile: sidebar ยุบเป็น drawer, ตารางเปลี่ยนเป็น card list

---

## 3. แผนผังหน้าจอ (Sitemap)

| ID | หน้าจอ | URL | ฟังก์ชัน |
|---|---|---|---|
| S00 | Sign in with Google | `/login`, `/auth/callback` | M1-01 |
| S01 | Dashboard | `/` | M11-01 |
| S02 | Calendar (Tape chart) | `/calendar` | M4-01, M4-02, M2-04 |
| S03 | Bookings list | `/bookings` | M5 |
| S04 | New booking (wizard) | `/bookings/new` | M5-01, M5-02, M3-09 |
| S05 | Booking detail | `/bookings/[code]` | M5, M6, M7, M8-02, M9 |
| S06 | Leases (Yearly) | `/leases` | M6, M4-03 |
| S07 | Payment board | `/payments` | M7-02 |
| S08 | Outstanding | `/payments/outstanding` | M7-10 |
| S09 | Payments received | `/payments/received` | M7-03, M7-05 |
| S10 | Meter reading sheet | `/meters` | M8 |
| S11 | Documents | `/documents`, `/documents/[number]/print` | M9 |
| S12 | Guests | `/guests`, `/guests/[id]` | M10 |
| S13 | Reports | `/reports/[type]` | M12 |
| S14 | Properties + Setup wizard | `/settings/properties`, `/settings/properties/new`, `/settings/properties/[code]` | M2, M3 |
| S15 | Team | `/settings/team` | M1-02, M1-03, M1-05, M1-06 |
| S16 | Business & Policies | `/settings/business`, `/settings/policies` | M1-04, M5-10 |
| S17 | Notifications (LINE) | `/settings/notifications` | M11-03 |
| S18 | Activity log | `/settings/activity` | M13-01 |

---

## 4. รายละเอียดหน้าจอ

### S00 — Login

```
┌──────────────────────────────┐
│          Pre-Booking         │
│  Sign in to your team        │
│  [ G  Continue with Google ] │
│  Only team members can sign  │
│  in. Ask your admin to add   │
│  your Google account.        │
└──────────────────────────────┘
```
- ไม่มีรหัสผ่าน · อีเมลที่ไม่อยู่ในทีมหรือถูกปิดใช้งาน → แสดงข้อความพร้อมอีเมลที่ใช้ และปุ่ม "Use another account"

---

### S01 — Dashboard

```
Today · Mon 26 Oct 2026                                         [ + New booking ]
┌────────────┬────────────┬────────────┬────────────┬────────────┐
│ Arrivals   │ Departures │ In-house   │ Vacant     │ Overdue    │
│     4      │     3      │  38 / 50   │    12      │ ฿48,200 (7)│
└────────────┴────────────┴────────────┴────────────┴────────────┘
┌─ Arrivals today ──────────────────────┐ ┌─ Departures today ───────────────────┐
│ 101 D  John Smith   BK-…0123 [Check in]│ │ 205 D  Mali K.   [Check out]          │
│ 310 Y  ACME Co.     BK-…0119 [Check in]│ │ ...                                  │
└───────────────────────────────────────┘ └──────────────────────────────────────┘
┌─ Payments due / overdue ──────────────┐ ┌─ Needs attention ────────────────────┐
│ 302 Y  Mar 2026 rent  ฿15,000  Overdue│ │ ⏱ 2 holds expire within 6 hours       │
│       5 days  [Record payment]        │ │ 📄 3 leases end within 30 days         │
│ ...                       View all →  │ │ ⚡ 18 units missing meter reading (25th)│
└───────────────────────────────────────┘ │ 🔧 2 units in maintenance              │
                                          └──────────────────────────────────────┘
```
- การ์ดตัวเลขกดแล้วไปหน้ารายการที่กรองไว้แล้ว
- โหมด `All properties`: เพิ่มคอลัมน์ Property ในทุกรายการ

---

### S02 — Calendar (Tape chart)

```
[◀ Today ▶]  Oct 2026   View: [2 weeks ▾]   Room type: [All ▾]   Mode: [All ▾]   [+ Block]
            │26 Mo│27 Tu│28 We│29 Th│30 Fr│31 Sa│ 1 Su│ 2 Mo│ ...
 Studio
  101  D Y  │██ John Smith (D) ████│     │░░ Hold: Anna ░░│     │
  102  D    │         │▓▓▓▓ Maintenance (Block) ▓▓▓▓│          │
 1 Bedroom
  201  Y    │████████████ ACME Co. (Y) · lease to 14 Mar 2027 ███████████████→
  202  D Y  │     │     │     │     │     │     │     │     │
```
- แถว = ห้อง (จัดกลุ่มตามประเภทห้อง) แสดง badge โหมดที่ห้องเปิด · คอลัมน์ = วัน (วันหยุดสุดสัปดาห์สีอ่อน)
- แถบการจองสีตามสถานะ + badge D/Y · ชี้แล้วเห็นสรุป (ผู้เข้าพัก, วันที่, ยอดค้าง)
- **ลากเลือกช่องว่าง** → เมนู: `New Daily booking` / `New Yearly booking` / `Block dates` → เปิด S04 พร้อมห้องและวันที่ที่เลือก
- คลิกแถบ → ไป S05
- ย้ายห้อง/เปลี่ยนวันด้วยการลาก **ไม่ทำใน MVP** (ป้องกันการแก้ผิดโดยไม่ตั้งใจ) ใช้ปุ่มในหน้า S05 แทน
- มุมมอง: 2 สัปดาห์ / เดือน / 3 เดือน (สำหรับดูสัญญารายปี)

---

### S03 — Bookings list

```
Bookings                                                          [ + New booking ]
[🔍 Search name / code / phone]  Status: [Active ▾]  Mode: [All ▾]  Dates: [____–____]  [Export]
┌──────────────┬──────┬──────┬───────────────┬──────────────────┬───────────┬──────────┬──────────┐
│ Code         │ Mode │ Unit │ Guest         │ Stay             │ Status    │ Total    │ Balance  │
├──────────────┼──────┼──────┼───────────────┼──────────────────┼───────────┼──────────┼──────────┤
│ SKV-BK-…0123 │  D   │ 101  │ John Smith    │ 26–29 Oct · 3n   │ Confirmed │  ฿4,500  │  ฿4,500  │
│ SKV-BK-…0119 │  Y   │ 201  │ ACME Co.      │ 15 Mar 26 – 15 Mar 27 │ Checked-in│ ฿180,000 │ ฿15,000🔴│
└──────────────┴──────┴──────┴───────────────┴──────────────────┴───────────┴──────────┴──────────┘
```
- Tabs ด่วน: `Upcoming` · `In-house` · `Holds` · `Past` · `Cancelled` · `All`
- Balance เป็นสีแดงเมื่อมีงวด Overdue

---

### S04 — New booking (Wizard)

ขั้นตอนแสดงเป็น stepper ด้านบน · ข้อมูลสรุปอยู่แผงขวาตลอด (sticky)

**Step 1 — Rental mode** (เลือกก่อน ตามที่ approve)
```
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  🌙  Daily                    │  │  📅  Yearly                   │
│  Nightly rate · check-in/out │  │  Lease contract · N years    │
│  Short stays                 │  │  Monthly installments, meter │
└──────────────────────────────┘  └──────────────────────────────┘
```

**Step 2 — Dates & guests**
| Daily | Yearly |
|---|---|
| Check-in, Check-out (date range) → แสดง `3 nights` | Move-in date, Term `[1] year(s)` → แสดง move-out date |
| Adults, Children | Adults, Children |
| Room type (optional) | Room type (optional) · แสดง "Paid monthly" |

**Step 3 — Select unit**
```
Available units · 26–29 Oct 2026 · Daily
┌──────┬────────────┬───────┬──────────────┬──────────────────┐
│ Unit │ Type       │ Floor │ Price        │                  │
│ 101  │ Studio     │ 1     │ ฿4,500 total │ [Select]         │
│ 202  │ 1 Bedroom  │ 2     │ ฿6,000 total │ [Select]         │
└──────┴────────────┴───────┴──────────────┴──────────────────┘
Not available (2) ▸   ← พับไว้ แสดงเหตุผล: booked / blocked / mode not enabled / over capacity
```

**Step 4 — Guest**
- ค้นหาผู้เข้าพักเดิม (ชื่อ/เบอร์/อีเมล) หรือ `+ New guest`
- ฟิลด์: Full name*, Phone, Email, LINE ID, Nationality, `Company` toggle → Company name, Tax ID, Branch, Billing address
- Additional occupants (optional)
- Yearly: ID document upload (หรือทำทีหลังตอน Check-in)

**Step 5 — Review & confirm**
```
┌─ Price breakdown ─────────────────────────┐  ┌─ Payment schedule preview ───────────┐
│ Daily · Unit 101 · 26–29 Oct (3 nights)   │  │ Pay in full before check-in          │ ← Daily
│  Mon 26 Oct          ฿1,400               │  │ #1 Stay 26–29 Oct   ฿4,800           │
│  Tue 27 Oct          ฿1,400               │  │ Pay by 26 Oct 00:00 (or room released)│
│  Wed 28 Oct          ฿1,700 (weekend)     │  └──────────────────────────────────────┘
│  Cleaning fee          ฿300               │
│  [+ Add fee]  [Adjust price…]             │   Yearly ตัวอย่าง:
│ ─────────────────────────────             │   #0 Deposit (2 mo) + move-in fee  26 Oct
│  Total                 ฿4,800             │   #1 Rent 26 Oct–26 Nov  ฿15,000   26 Oct
└───────────────────────────────────────────┘   #2 Rent 26 Nov–26 Dec  ฿15,000   26 Nov
Source: [Walk-in ▾]  Note: [__________]          … (12 rows, scrollable)

[ Save booking (Hold until paid) ]   [ Save & record payment ]
```
- `Adjust price…` (M3-10): แก้ราคา/ส่วนลด + เหตุผล (บังคับ) · Front desk ปรับได้ไม่เกินเพดานที่ตั้งไว้
- การจองทุกโหมดบันทึกเป็น `Hold` ก่อน → ระบบเปลี่ยนเป็น `Confirmed` อัตโนมัติเมื่อ: **Daily** จ่ายครบ · **Yearly** จ่ายงวดแรกเข้า (เงินประกัน + ค่าเช่าล่วงหน้า) ครบ
- Yearly: ตัวเลือก Advance months, Deposit months (ค่าเริ่มต้นจาก rate plan) · หลังยืนยัน → ไปสร้างสัญญาที่แท็บ Lease
- กรณีห้องถูกจองตัดหน้า (error `BOOKING_CONFLICT`) → แจ้ง "This unit was just booked" และกลับไป Step 3

---

### S05 — Booking detail

```
SKV-BK-2026-000123   [Daily] [Confirmed]                     [Check in] [More ▾]
John Smith · +66 81 234 5678 · Unit 101 (Studio) · 26–29 Oct 2026 · 3 nights
Total ฿4,800 · Paid ฿1,000 · Balance ฿3,800
────────────────────────────────────────────────────────────────────────────────
[ Overview ] [ Charges & Payments ] [ Lease ] [ Meters ] [ Documents ] [ Activity ]
```
- **More ▾:** Edit, Move unit, Extend, Cancel, Mark no-show, Print confirmation
- แท็บ **Lease** และ **Meters** แสดงเฉพาะ Yearly
- ปุ่มหลักเปลี่ยนตามสถานะ: Hold → `Confirm` · Confirmed → `Check in` · Checked-in → `Check out` · Checked-out → `Settle & close`

**Tab: Overview** — ข้อมูลผู้เข้าพัก/ผู้พักร่วม, ห้อง, เวลาเข้า-ออกจริง, หมายเหตุ, price snapshot, cancellation policy

**Tab: Charges & Payments** (หัวใจของ "สถานะรายวัน/รายเดือน")
```
                                                    [ Record payment ] [ Issue invoice ]
┌───┬─────────────────────┬──────────┬──────────┬──────────┬──────────┬───────────┬────────────┐
│ # │ Period              │ Due      │ Amount   │ Paid     │ Balance  │ Status    │ Paid on    │
├───┼─────────────────────┼──────────┼──────────┼──────────┼──────────┼───────────┼────────────┤
│ 0 │ Deposit + move-in   │ 15 Mar   │ ฿32,000  │ ฿32,000  │ ฿0       │ 🟢 Paid    │ 15 Mar 2026│
│ 1 │ 15 Mar – 15 Apr     │ 15 Mar   │ ฿15,000  │ ฿15,000  │ ฿0       │ 🟢 Paid    │ 15 Mar 2026│
│ 2 │ 15 Apr – 15 May  ▸  │ 15 Apr   │ ฿16,240  │ ฿10,000  │ ฿6,240   │ 🟡 Partial │ –          │
│ 3 │ 15 May – 15 Jun     │ 15 May   │ ฿15,980  │ ฿0       │ ฿15,980  │ 🔴 Overdue │ –          │
│ 4 │ 15 Jun – 15 Jul     │ 15 Jun   │ ฿15,000  │ ฿0       │ ฿15,000  │ ⚪ Upcoming│ –          │
└───┴─────────────────────┴──────────┴──────────┴──────────┴──────────┴───────────┴────────────┘
 ▸ กดขยายงวด: รายการย่อย (Rent ฿15,000 · Water 12 units ฿216 · Electric 128 units ฿1,024 · Late fee …)
   และรายการรับเงินที่ตัดเข้างวดนี้ · เมนูงวด: Add charge / Add discount / Waive
Payments received
 15 Apr 2026  ฿10,000  Transfer  Ref 1234  🧾 SKV-RC-2026-00042   [View slip] [Void]
```

**Modal: Record payment** (M7-03, M7-04, M7-08)
```
┌─ Record payment ───────────────────────────────────┐
│ Amount received*   [ 21,240.00 ]   Outstanding ฿22,220│
│ Payment date*      [ 26 Oct 2026 📅 ]               │
│ Method*            (•) Transfer ( ) Cash ( ) Cheque ( ) Card ( ) Other │
│ Reference          [__________]                    │
│ Slip               [ Upload image ]                │
│ ☐ Withholding tax  [ 5 ]%  Cert no. [______]       │
│ Apply to:  (•) Oldest first  ( ) Choose periods     │
│   ☑ #2 ฿6,240   ☑ #3 ฿15,000 (of ฿15,980)           │
│ Note               [__________]                    │
│ ☑ Issue receipt after saving                       │
│                         [Cancel]  [Save payment]   │
└────────────────────────────────────────────────────┘
```

**Modal: Check-in** — ยืนยันตัวตน (อัปโหลดบัตร/พาสปอร์ต), เวลาเข้าจริง, (Yearly) **เลขมิเตอร์น้ำ/ไฟตอนเข้า + รูป**, แจ้งเตือนถ้ายังมียอดค้างที่ถึงกำหนด

**Modal: Check-out** — เวลาออกจริง, (Yearly) เลขมิเตอร์ตอนออก, รายการค่าเสียหาย, สรุปยอดสุดท้าย → ไปขั้น `Deposit settlement`

**Modal: Deposit settlement** (M7-09)
```
Deposit held                     ฿30,000
− Final water/electric             ฿1,180
− Damage: broken mirror (📷 2)       ฿800
− Outstanding balance                ฿0
───────────────────────────────────────
Refund to tenant                 ฿28,020   Date [__]  Method [Transfer ▾]
```

**Modal: Cancel** — แสดงยอดคืนตาม policy (แก้ได้ถ้าเป็น Manager+) + เหตุผล

**Tab: Lease** (Yearly · M6)
- สถานะสัญญา, วันเริ่ม/สิ้นสุด, ค่าเช่า, รูปแบบงวด, เงินประกัน, ระยะแจ้งล่วงหน้า, เงื่อนไขออกก่อนกำหนด
- ปุ่ม: `Generate contract (PDF)` · `Upload signed contract` · `Give notice` · `Renew` · `Terminate`
- Renew: ตั้งวันสิ้นสุดใหม่ + ค่าเช่าใหม่ → แสดงงวดที่จะเพิ่ม

**Tab: Meters** (Yearly) — ประวัติการจดมิเตอร์ของห้องในช่วงที่ผู้เช่าอยู่ + หน่วยที่ใช้ + ยอดที่คิดแล้ว

**Tab: Documents** — Invoice/Receipt ของการจองนี้ (เลขที่, วันที่, ยอด, สถานะ) + View/Print/Void

**Tab: Activity** — ประวัติสถานะและการแก้ไขทั้งหมด (ใคร ทำอะไร เมื่อไร)

---

### S06 — Leases (Yearly)

```
Leases   Tabs: [Active] [Ending in 30/60/90 days] [Notice given] [Ended]
┌──────┬──────────────┬─────────────┬─────────────┬──────────┬─────────────┬──────────────┐
│ Unit │ Tenant       │ Start       │ End         │ Rent/mo  │ Status      │              │
│ 201  │ ACME Co.     │ 15 Mar 2026 │ 15 Mar 2027 │ ฿15,000  │ Active      │ [Renew]      │
│ 305  │ Somchai P.   │ 1 Dec 2025  │ 1 Dec 2026  │ ฿12,000  │ Ends in 36d │ [Renew][Notice]│
└──────┴──────────────┴─────────────┴─────────────┴──────────┴─────────────┴──────────────┘
```

---

### S07 — Payment board (สถานะรายวัน / รายเดือนแบบภาพรวม)

```
Payment board    Mode: [Yearly ▾]   Year: [2026 ▾]   Status: [All ▾]
         │ Jan │ Feb │ Mar │ Apr │ May │ Jun │ Jul │ Aug │ Sep │ Oct │ Nov │ Dec │
 201 ACME│     │     │ 🟢  │ 🟢  │ 🟡  │ 🔴  │ ⚪  │ ⚪  │ ⚪  │ ⚪  │ ⚪  │ ⚪  │
 202 Lee │ 🟢  │ 🟢  │ 🟢  │ 🟢  │ 🟢  │ 🟢  │ 🟢  │ 🟢  │ 🟢  │ 🔵  │ ⚪  │ ⚪  │
```
- **Yearly:** ห้อง × เดือน (ช่องตามวันครบกำหนดของงวด)
- **Daily:** สลับ Mode = Daily → ห้อง × วัน ในเดือนที่เลือก · แต่ละการจองเป็นแถบเดียวสีตามสถานะการจ่าย (Paid = เขียว · Unpaid/Partial ก่อนเข้าพัก = เหลือง)
- คลิกช่อง → popover: งวด, ยอด, จ่ายแล้ว, วันที่จ่าย + ปุ่ม `Record payment` / `Open booking`
- แถวสรุปด้านล่าง: ยอดเรียกเก็บ / ยอดรับ / ยอดค้าง ต่อคอลัมน์

---

### S08 — Outstanding (M7-10)

- การ์ด: `Due` · `1–30 days` · `31–60 days` · `60+ days` (จำนวนและยอด)
- ตาราง: Unit, Guest, Period, Due date, Days overdue, Balance, Late fee, Phone, `[Record payment]`
- Export CSV, Print list

### S09 — Payments received

- ตาราง: Date, Booking, Guest, Amount, WHT, Method, Reference, Receipt no., Recorded by
- กรอง: วันที่, วิธีชำระ, ผู้บันทึก · รวมยอดตามวิธีชำระ (ใช้กระทบยอดเงินสด/บัญชีธนาคารรายวัน)
- `Void` (Manager+) ต้องใส่เหตุผล

---

### S10 — Meter reading sheet (ใช้บนมือถือได้) — M8

```
Meter readings   Reading date: [25 Oct 2026]   Utility: [Electric ▾]   Floor: [All ▾]
Progress: 32 / 50 recorded
┌──────┬──────────────┬──────────┬─────────────┬───────┬──────┐
│ Unit │ Tenant       │ Previous │ Current     │ Usage │ 📷   │
│ 201  │ ACME Co.     │ 4,512    │ [ 4,640   ] │ 128   │ [+]  │
│ 202  │ Lee W.       │ 3,980    │ [ 3,975   ] │ ⚠ −5  │ [+]  │  ← ค่าติดลบ: แจ้งเตือน
│ 203  │ (vacant)     │ 1,200    │ [         ] │       │      │
└──────┴──────────────┴──────────┴─────────────┴───────┴──────┘
⚠ 1 warning · 18 missing                   [Save draft]  [Save & bill utilities]
```
- กด Enter ไปช่องถัดไป (กรอกเร็วทั้งตึก) · บันทึกอัตโนมัติทุกช่อง
- เตือนเมื่อ: เลขลดลง, ใช้มากกว่าค่าเฉลี่ย 3 เดือนเกินเกณฑ์, ยังไม่จด
- `Save & bill utilities` → สร้างบรรทัดค่าน้ำ/ไฟเข้างวดถัดไปของแต่ละสัญญา (แสดงสรุปก่อนยืนยัน)
- Mobile: แสดงทีละห้องเป็น card + ปุ่มถ่ายรูปมิเตอร์

---

### S11 — Documents (M9)

- ตาราง: Number, Type (Invoice/Receipt), Date, Booking, Bill to, Total, Status · กรอง/ค้นหา
- **Print view** `/documents/[number]/print` — หน้า A4 (print CSS) + ปุ่ม `Download PDF` (สร้างใน browser) · พิมพ์ซ้ำมีลายน้ำ `COPY`
- `Void` → เหตุผล + ตัวเลือก "Re-issue" (ออกเลขใหม่อ้างใบเดิม)

```
┌──────────────────────────── A4 ─────────────────────────────┐
│ [LOGO] Sukhumvit Residence                     RECEIPT        │
│ 123 Sukhumvit Rd, Bangkok · Tax ID 0105…       No. SKV-RC-2026-00042│
│                                                Date 26 Oct 2026│
│ Received from: ACME Co., Ltd. (Tax ID …, Head Office)           │
│ Booking SKV-BK-2026-000119 · Unit 201                            │
│ ─────────────────────────────────────────────────────────────── │
│ Description                                   Amount              │
│ Rent 15 Apr – 15 May 2026                    15,000.00           │
│ Water 12 units × 18.00                          216.00           │
│ Electric 128 units × 8.00                     1,024.00           │
│ ─────────────────────────────────────────────────────────────── │
│ Total                                    THB 16,240.00           │
│ Withholding tax 5%                              750.00           │
│ Amount received                          THB 15,490.00           │
│ (Fifteen thousand four hundred ninety baht only)                  │
│ Method: Bank transfer · Ref 1234                                   │
│                                            Received by ________   │
└──────────────────────────────────────────────────────────────────┘
```
(ตัวอย่างนี้สมมติว่าคิดหัก ณ ที่จ่ายจากค่าเช่าอย่างเดียว · ฐานที่ใช้คิดหัก ณ ที่จ่ายกำหนดได้ตอนบันทึกรับเงิน)

---

### S12 — Guests (M10)

- รายการ: Name, Phone, Email, Company, Bookings count, Last stay
- รายละเอียด: ข้อมูลติดต่อ, ข้อมูลออกเอกสาร (Bill to), เอกสารยืนยันตัวตน (**แสดงเฉพาะ Admin/Manager/Front desk**, เปิดดูผ่านลิงก์ชั่วคราว), ประวัติการจองทั้งหมด, ยอดค้างรวม

### S13 — Reports (M12)

| รายงาน | ตัวกรอง | แสดงผล |
|---|---|---|
| Occupancy | ที่พัก, ช่วงเวลา, โหมด, ประเภทห้อง | กราฟเส้น % + ตาราง |
| Revenue (cash basis) | ที่พัก, ช่วงเวลา, โหมด | กราฟแท่งแยก Rent / Nightly / Water / Electric / Fees |
| Outstanding & Deposits | ที่พัก | ตาราง + ยอดรวม |
| Property comparison | ช่วงเวลา | ตารางเทียบ Occupancy / Revenue / Outstanding ต่อที่พัก |

ทุกรายงานมี `Export CSV`

---

### S14 — Properties + Setup wizard (M2, M3)

**Properties list:** การ์ดที่พัก (ชื่อ, รหัส, ประเภท, จำนวนห้อง, Occupancy, สถานะ Draft/Active/Archived) + `[+ Add property]`

**Setup wizard** (`/settings/properties/new`) — บันทึกเป็น Draft ได้ทุกขั้น
```
 ① Details ─ ② Room types ─ ③ Units ─ ④ Rates ─ ⑤ Utilities ─ ⑥ Staff ─ ✓ Activate
```
| ขั้น | ฟิลด์ |
|---|---|
| ① Details | Name*, Code* (2–6 ตัว A-Z/0-9), Type, Address, Phone, Check-in/out time, Meter reading day, Grace days, Late fee, Payment instructions + QR image, Document issuer (ใช้ข้อมูลบริษัท / กำหนดเอง) |
| ② Room types | Name, Max occupancy, Size, Amenities, Photos (เพิ่มได้หลายแบบ) |
| ③ Units | **Bulk add:** Prefix/From–To (เช่น 101–120), Floor, Room type, Modes `☑ Daily ☑ Yearly` · แก้รายห้องในตารางได้ |
| ④ Rates | ต่อประเภทห้อง: **Daily** (base, weekend, min/max nights, cancellation policy) · **Yearly** (rent/month, deposit months, advance months) · Seasonal overrides (ทำทีหลังได้) · Fees |
| ⑤ Utilities | Water/Electric: price per unit, minimum charge · เลขมิเตอร์เริ่มต้นรายห้อง (ข้ามได้ถ้าไม่มี Yearly) |
| ⑥ Staff | เลือกพนักงานที่เข้าถึงที่พักนี้ |
| ✓ Activate | Checklist ความครบถ้วน (ทุกห้องมี rate ของโหมดที่เปิด ฯลฯ) → `Activate property` |

**Property settings** (`/settings/properties/[code]`) — แท็บเดียวกับขั้นของ wizard: General · Room types · Units · Rates · Fees · Utilities · Staff · + `Archive property`

### S15 — Team (Admin)

- ตาราง: Name (จาก Google), Google email, Role, Properties, Status (`Active` · `Not signed in yet` · `Deactivated`), Last active · `[Add member]`
- Add member: Google email, Role, Properties (หลายที่ได้) → login ได้ทันที · Deactivate (ตัด session ทันที) / Change role
- แสดงจุดเขียวข้างชื่อคนที่ออนไลน์อยู่ตอนนี้

### ทุกหน้า — ใช้งานพร้อมกัน (M1-06)
- ข้อมูลรีเฟรชเองเมื่อคนอื่นแก้ ไม่ต้องกดโหลดใหม่
- หน้าการจองแสดง avatar ของคนที่เปิดอยู่พร้อมกัน เช่น "Pim is also viewing"
- ถ้าบันทึกชนกัน: แถบแจ้ง "Updated by Pim a moment ago" + ปุ่ม Review changes

### S16 — Business & Policies

- **Business:** Legal name, Address, Tax ID, Logo, Hold expiry (hours), Price adjustment limit for Front desk (%)
- **Cancellation policies:** รายการ policy + ตัวแก้กฎ `[days before] → [refund %]` (เพิ่ม/ลบแถว) + ตัวอย่างการคำนวณ

### S17 — Notifications (LINE)

- ขั้นตอนเชื่อมต่อ: ใส่ Channel secret / access token → แสดง Webhook URL ให้คัดลอก → เพิ่มบอทเข้ากลุ่ม → พิมพ์ `link SKV` ในกลุ่มเพื่อผูกกลุ่มกับที่พัก
- ตั้งเวลาสรุปรายวัน (ค่าเริ่มต้น 08:00), เลือกหัวข้อในสรุป, `[Send test message]`
- **โควตา:** แถบแสดง push ที่ใช้ไปเดือนนี้ / เพดาน (เช่น 87 / 200)

### S18 — Activity log (Admin)

- ตาราง: เวลา, ผู้ใช้, Action, Entity (ลิงก์), ดูความต่าง before/after · กรองตามผู้ใช้/ประเภท/วันที่

---

## 5. Flow หลัก

**Daily — จองล่วงหน้า / walk-in**
`+ New booking` → Daily → วันที่ → เลือกห้อง → ผู้เข้าพัก → Save (Hold) → `Record payment` เต็มจำนวน → Confirmed อัตโนมัติ + Receipt → วันเข้าพัก `Check in` (ปุ่มกดไม่ได้ถ้ายังมียอดค้าง)

**Yearly — ผู้เช่าใหม่**
`+ New booking` → Yearly → วันเข้า + 1 ปี → เลือกห้อง → ผู้เช่า (บริษัท) → Save (Hold) → รับเงินประกัน + ค่าเช่าล่วงหน้า (Record payment) → Confirmed อัตโนมัติ → Lease tab: Generate contract → Upload signed → `Check in` (จดมิเตอร์ตอนเข้า)

**รายเดือนของผู้เช่ารายปี**
วันที่ 25: S10 จดมิเตอร์ทั้งตึก → `Save & bill utilities` → งวดถัดไปมีค่าน้ำ/ไฟ → (ตัวเลือก) Issue invoice → ผู้เช่าโอน → S05/S07 `Record payment` → Receipt

**ย้ายออก (Yearly)**
`Give notice` → ถึงวันออก `Check out` (มิเตอร์ตอนออก + ค่าเสียหาย) → Deposit settlement → คืนเงิน → `Close`

---

## 6. สิทธิ์ตามบทบาท (สิ่งที่เห็น/ทำได้บนหน้าจอ)

| หน้าจอ / การกระทำ | Admin | Manager | Front desk | Accountant |
|---|:-:|:-:|:-:|:-:|
| Dashboard, Calendar, Bookings (ดู) | ✓ | ✓ | ✓ | ✓ |
| สร้าง/แก้การจอง, Check-in/out | ✓ | ✓ | ✓ | – |
| ปรับราคาเกินเพดาน, Waive, แก้ยอดคืนเงิน | ✓ | ✓ | – | ✓ |
| Record payment | ✓ | ✓ | ✓ | ✓ |
| Void payment / document | ✓ | ✓ | – | ✓ |
| Meters | ✓ | ✓ | ✓ | ดู |
| Reports | ✓ | ✓ | – | ✓ |
| Settings: Properties / Rates | ✓ | ✓ | – | – |
| Settings: Users, Business, LINE, Activity log | ✓ | – | – | – |
| ดูเอกสารยืนยันตัวตน | ✓ | ✓ | ✓ | – |

---

## 7. สถานะของหน้าจอ (ทุกหน้า)

- **Loading:** skeleton ตามโครงหน้า
- **Empty:** ข้อความ + ปุ่มทำต่อ (เช่น "No properties yet — Add property")
- **Error:** toast สำหรับ error ทั่วไป · inline สำหรับ error ในฟอร์ม · ข้อความเฉพาะ: `This unit was just booked by someone else`, `This booking was changed by another user — reload`, `Hold expired`
- **ยืนยันก่อนทำ** สำหรับ action ที่ย้อนไม่ได้: Cancel, Void, Terminate, Archive (ต้องพิมพ์เหตุผล)
- **Toast สำเร็จ** พร้อมลิงก์ เช่น "Payment saved · Receipt SKV-RC-2026-00042 [Print]"

---

## 8. ลำดับการพัฒนาหน้าจอ (เสนอ)

| Sprint | หน้าจอ |
|---|---|
| 1 | S00 Login, Layout, S15 Users, S16 Business, S14 Properties + Wizard |
| 2 | S04 New booking, S03 Bookings list, S05 Booking detail (Overview), S02 Calendar |
| 3 | S05 Charges & Payments + Record payment, S07 Payment board, S08, S09, S11 Documents + Print |
| 4 | S05 Lease/Meters + Check-in/out/Deposit, S06 Leases, S10 Meters |
| 5 | S01 Dashboard, S12 Guests, S13 Reports, S17 LINE, S18 Activity log |

---

## 9. สถานะ

โครงหน้าจอ Approved · ขอบเขตรอบนี้: **wireframe เท่านั้น** (`docs/wireframes/index.html`)
