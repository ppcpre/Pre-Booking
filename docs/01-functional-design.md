# Pre-Booking — Functional Design (v1.3, Approved)

ระบบให้ **พนักงานของบริษัท** จัดการที่พัก (เพิ่มได้หลายแห่ง) และบันทึกการจอง รองรับการเช่า **2 โหมด**: **รายวัน (Daily)** และ **รายปี (Yearly)**

| ชั้น | เทคโนโลยี |
|---|---|
| FE | Next.js (App Router) + TypeScript + React · UI และเอกสารภาษาอังกฤษ |
| BE | Next.js Server Actions / Route Handlers บน **Cloudflare Workers** (ผ่าน OpenNext adapter) |
| DB | PostgreSQL บน **Supabase** (+ Supabase Auth, Storage, pg_cron) · เชื่อมจาก Workers ผ่าน **Cloudflare Hyperdrive** |
| แจ้งเตือน | LINE Official Account (Messaging API, free plan) + แจ้งเตือนในแอป |

> เอกสารนี้เป็นการออกแบบ **ฟังก์ชัน ข้อมูล และกฎทางธุรกิจ** เท่านั้น หน้าจอจะออกแบบหลังจากเอกสารนี้ได้รับการ approve

### สิ่งที่เปลี่ยนใน v1.3

| # | ความต้องการ | ผลต่อการออกแบบ |
|---|---|---|
| 1 | **เข้าระบบด้วย Gmail** | Login ด้วย **Google (Sign in with Google)** ผ่าน Supabase Auth อย่างเดียว ไม่มีรหัสผ่านให้จำ · เข้าได้เฉพาะอีเมลที่ Admin เพิ่มไว้ในรายชื่อทีม (allowlist) |
| 2 | **ใช้งานพร้อมกันหลายคน** | ไม่จำกัดจำนวนผู้ใช้/อุปกรณ์ · ข้อมูลอัปเดตแบบ real-time (Supabase Realtime) บนปฏิทิน รายการจอง และหน้ารับเงิน · แสดงว่าใครกำลังเปิดการจองเดียวกันอยู่ · กันการบันทึกทับกันด้วย version check (มีอยู่แล้ว) |

### สิ่งที่เปลี่ยนใน v1.2

| # | กฎทางธุรกิจ | ผลต่อการออกแบบ |
|---|---|---|
| 1 | **ให้จองก่อนได้** | สร้างการจองโดยยังไม่จ่ายได้ สถานะ `HOLD` แสดงบน UI เป็น **Reserved** · รายวันจ่ายเมื่อไรก็ได้จนถึงเวลาเช็กอินของวันเข้าพัก (พนักงานตั้งกำหนดให้เร็วขึ้นได้ต่อการจอง) · ระบบเตือนก่อนครบกำหนด 24 ชม. · เลยกำหนดแล้วยังจ่ายไม่ครบ → `EXPIRED` ห้องว่าง |

### สิ่งที่เปลี่ยนใน v1.1

| # | กฎทางธุรกิจ | ผลต่อการออกแบบ |
|---|---|---|
| 1 | **รายปี: ลูกค้าจ่ายรายเดือนเท่านั้น** | ตัดตัวเลือกจ่ายราย 3 เดือน / 6 เดือน / ทั้งปี และส่วนลดจ่ายล่วงหน้าทั้งปี · ทุกสัญญาเป็นงวดรายเดือนนับจากวันเข้าพัก · ค่าน้ำ/ไฟเข้างวดรายเดือนถัดไปเสมอ |
| 2 | **รายวัน: จองและจ่ายเต็มจำนวนก่อนเข้าพัก** | ตัดตัวเลือก `PER_STAY` / `PER_NIGHT` → รายวันมี **1 งวดต่อการจอง** · การจองเป็น `HOLD` จนจ่ายครบ แล้วระบบเปลี่ยนเป็น `CONFIRMED` อัตโนมัติ · **Check-in ไม่ได้ถ้ายังจ่ายไม่ครบ** · ขยายคืนต้องจ่ายส่วนเพิ่มก่อน |

### สิ่งที่เปลี่ยนจาก v0.3 (Approved)

| # | คำตอบ | ผลต่อการออกแบบ |
|---|---|---|
| 1 | ยืนยันให้เลือกโหมดก่อน | ขั้นแรกของการสร้างการจองคือเลือกโหมด · รายวันเลือก `PER_STAY` / `PER_NIGHT` ได้ |
| 2 | **มี 2 โหมด: รายวัน และ รายปี** | ตัดโหมดรายเดือนออก · รายปีจ่ายเป็นงวดรายเดือนได้ (รอบบิลตามวันเข้าพัก) · ค่าน้ำ/ไฟตามมิเตอร์ใช้กับรายปี |
| 3 | ใช้ Cloudflare | ยืนยัน Cloudflare Workers (หัวข้อ 9.1) |

### สิ่งที่เปลี่ยนจาก v0.2

| # | คำตอบ | ผลต่อการออกแบบ |
|---|---|---|
| 1 | ให้เลือกก่อนว่าเช่ารายวันหรือรายปี | ขั้นแรกของการสร้างการจอง = **เลือกโหมด** แล้วฟอร์มจึงเปลี่ยนตามโหมด · การจองรายวันเลือกได้ว่าจะติดตามการจ่าย **ทีละคืน** หรือ **ทั้งการจอง** (หัวข้อ 5.1) |
| 2 | ยังไม่ทำเรื่อง VAT | ตัด VAT และใบกำกับภาษีออกจาก MVP เหลือ **Invoice + Receipt** · ออกแบบให้เพิ่ม VAT ภายหลังได้ (เฟส 2) |
| 3 | ใช้ EN | UI **และเอกสาร** (Invoice / Receipt / สัญญา) เป็นภาษาอังกฤษ |
| 4 | รองรับการเพิ่มที่พัก | เพิ่มขั้นตอนเพิ่มที่พักแบบทีละขั้น (setup wizard), สลับที่พักในแอป, กำหนดสิทธิ์พนักงานรายที่พัก, เลขที่เอกสารแยกตามที่พัก (M2) |
| 5 | ใช้ Cloudflare | Deploy บน Cloudflare Workers + Hyperdrive + Cron Triggers (หัวข้อ 9.1) |

### สิ่งที่เปลี่ยนจาก v0.1

| # | คำตอบ | ผลต่อการออกแบบ |
|---|---|---|
| 1 | ใช้ธุรกิจเดียว | ตัด multi-tenant (`organizations`, `org_id`) ออก เหลือตารางตั้งค่าธุรกิจ 1 แถว |
| 2 | พนักงานบันทึกการจองเอง | ตัดหน้าจองออนไลน์สำหรับลูกค้า (booking engine) และพอร์ทัลผู้เช่าออกจากขอบเขต |
| 3 | รอบบิลรายเดือนตามวันเข้าพัก | ใช้ `ANNIVERSARY` อย่างเดียว ตัดรอบบิลวันที่ 1 และการคิดเงินเดือนแรกตามสัดส่วน (proration) ออก |
| 4 | ค่าน้ำ/ไฟตามมิเตอร์จริง | มีระบบจดมิเตอร์ (ทั้งอาคาร + ตอนเข้า/ออก) |
| 5 | ไม่มีการชำระออนไลน์ | บันทึกการรับเงินด้วยมือ (วันที่จ่าย, วิธี, สลิป) และ **มีสถานะกำกับทุกงวด (รายวัน/รายเดือน)** — ดูหัวข้อ 5 |
| 6 | ออกใบเสร็จ + ใบกำกับภาษี | เพิ่มโมดูลเอกสาร: เลขที่ต่อเนื่อง, ยกเลิกแทนการลบ, ใบลดหนี้ |
| 7 | แจ้งเตือนทาง LINE แบบฟรี | LINE OA free plan: ส่งสรุปรายวันเข้ากลุ่มพนักงาน + แจ้งเตือนในแอป (ดูหัวข้อ 8) |
| 8 | UI ภาษาอังกฤษ | ข้อความ UI/enum เป็นภาษาอังกฤษ |
| 9 | Sync OTA เฟส 2 | iCal อยู่เฟส 2 |
| — | ใช้ Supabase | Supabase Auth, RLS, Storage, pg_cron (ดูหัวข้อ 9) |

---

## 1. Best Practices ที่นำมาใช้

| # | Best Practice | นำมาใช้อย่างไร |
|---|---|---|
| 1 | แยกการจองระยะสั้นกับสัญญาเช่าระยะยาว | รายวัน = `Booking` · รายปี = `Booking` + `Lease` |
| 2 | ช่วงวันที่แบบ half-open `[check_in, check_out)` | วันออกของคนหนึ่งเป็นวันเข้าของอีกคนได้ |
| 3 | กันจองซ้อนที่ระดับ DB | `EXCLUDE USING gist` บน `daterange` (Supabase รองรับ `btree_gist`) |
| 4 | Hold มีวันหมดอายุ | ล็อกห้องระหว่างรอลูกค้าโอนมัดจำ แล้วปล่อยอัตโนมัติ |
| 5 | State machine ชัดเจน + ประวัติสถานะ | ตาราง `booking_status_history` |
| 6 | เก็บสำเนาราคาตอนจอง (price snapshot) | แก้เรทภายหลังไม่กระทบการจองเดิม |
| 7 | เก็บเงินเป็นจำนวนเต็มหน่วยสตางค์ | `BIGINT` |
| 8 | Timezone ชัดเจน | วันที่พักเป็น `DATE` (เวลาไทย) · timestamp เป็น `TIMESTAMPTZ` · DB ของ Supabase ใช้ UTC แอปแปลงเป็น `Asia/Bangkok` |
| 9 | Idempotency key | กดบันทึกซ้ำไม่เกิดรายการซ้ำ |
| 10 | เอกสารการเงินห้ามลบ/แก้ | ยกเลิก (void) + ออกใบลดหนี้/ใบใหม่ เลขที่ต่อเนื่องไม่ข้าม |
| 11 | แยกเงินประกันออกจากรายได้ | ติดตามรับ → ถือ → หัก → คืน |
| 12 | Audit log | ทุก action สำคัญบันทึก before/after |
| 13 | สิทธิ์ตามบทบาท + Row-Level Security | Supabase RLS ทุกตาราง (ป้องกันกรณีเผลอใช้ anon key) |
| 14 | PDPA | ไฟล์บัตรประชาชน/พาสปอร์ตอยู่ใน private bucket, ดูผ่าน signed URL ที่หมดอายุ, จำกัดสิทธิ์ |

---

## 2. แนวคิดหลัก (Domain Model)

```
BusinessSettings (1 แถว)
Property (ที่พัก — เพิ่มได้หลายแห่ง) ── PropertyStaff
 ├── RoomType ── RatePlan (DAILY / YEARLY)
 └── Unit (ห้อง) ── Meter (น้ำ/ไฟ)
       └── Booking ──(YEARLY)──> Lease
             ├── Guest (ผู้เข้าพักหลัก + ผู้พักร่วม)
             ├── ChargePeriod (งวด: ทั้งการจอง / รายคืน / งวดของสัญญารายปี) ── ChargeLine
             ├── Payment ── PaymentAllocation ──> ChargePeriod
             ├── Document (Invoice / Receipt)
             └── Deposit ── DepositDeduction
```

### 2.1 โหมดการเช่า

| หัวข้อ | รายวัน (DAILY) | รายปี (YEARLY) |
|---|---|---|
| หน่วยราคา | ต่อคืน | ค่าเช่าต่อเดือน หรือ ต่อปี (สัญญาเป็นจำนวนปี: 1, 2, ...) |
| ระยะ | min/max nights | สัญญา N ปี (ขั้นต่ำ 1 ปี) |
| เอกสารสัญญา | – | Lease |
| **การชำระ** | **จ่ายเต็มจำนวนก่อนเข้าพัก** | **จ่ายรายเดือน** (นับรอบจากวันเข้าพัก) |
| **งวด (Charge period)** | 1 งวดต่อการจอง (+ งวดเพิ่มเมื่อขยายคืน) | งวดแรกเข้า (เงินประกัน + ค่าเช่าล่วงหน้า) + งวดรายเดือน |
| เงินประกัน | ไม่บังคับ | ตั้งค่าเป็นจำนวนเดือน |
| ค่าน้ำ/ไฟ | รวมในราคา | ตามมิเตอร์ ออกบิลทุกเดือน |
| ยกเลิก/ออกก่อน | Cancellation policy | แจ้งล่วงหน้า N วัน + ค่าปรับตามสัญญา |

ห้องเดียวเปิดได้ทั้ง 2 โหมด (`units.allowed_modes`) และทั้ง 2 โหมดใช้ตารางการจองและปฏิทินเดียวกัน (เช่น ห้องว่างช่วงรอผู้เช่ารายปีคนใหม่ เปิดขายรายวันได้)

---

## 3. รายการฟังก์ชัน (Function List)

**P** = Priority (1 = MVP, 2 = เฟส 2) · ~~ขีดฆ่า~~ = ตัดออกจาก v0.1

### M1 — ผู้ใช้และสิทธิ์

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M1-01 | Login ด้วย Google | ปุ่ม "Continue with Google" (Gmail หรือ Google Workspace) · ไม่มี email/password · เข้าได้เฉพาะอีเมลที่อยู่ในรายชื่อทีม; อีเมลอื่นเห็นข้อความ "This Google account isn't on the team. Ask your admin to add it." · session หมดอายุตามค่าตั้ง (ค่าเริ่มต้น 7 วัน) | 1 |
| M1-02 | จัดการทีม | Admin เพิ่มอีเมล Google + บทบาท + ที่พัก → ผู้นั้น login ได้ทันที (ส่งอีเมลแจ้งเป็นตัวเลือก) · ปิดการใช้งาน = ตัด session ที่ค้างอยู่ทันที · Admin คนแรกตั้งจากตัวแปร `BOOTSTRAP_ADMIN_EMAIL` ตอน deploy | 1 |
| M1-06 | ใช้งานพร้อมกันหลายคน | ข้อมูลบนจอรีเฟรชเองเมื่อคนอื่นแก้ (Realtime) · แสดงชื่อคนที่เปิดการจองเดียวกันอยู่ (presence) · ถ้าแก้ชนกัน แจ้ง "Updated by Pim a moment ago — review changes" | 1 |
| M1-03 | บทบาท | `ADMIN` (ทุกอย่าง + ตั้งค่า), `MANAGER` (ทุกอย่างยกเว้นจัดการผู้ใช้), `FRONT_DESK` (จอง/เช็กอิน/รับเงิน/จดมิเตอร์), `ACCOUNTANT` (การเงิน/เอกสาร/รายงาน, ดูการจองได้) | 1 |
| M1-04 | ตั้งค่าธุรกิจ | ชื่อ, ที่อยู่, เลขผู้เสียภาษี (แสดงบนเอกสาร ถ้ามี), โลโก้ | 1 |
| M1-05 | สิทธิ์รายที่พัก | ADMIN เห็นทุกที่พัก · บทบาทอื่นเห็นเฉพาะที่พักที่ได้รับมอบหมาย | 1 |

### M2 — ที่พักและห้อง (เพิ่มที่พักได้ไม่จำกัด)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M2-00 | **ตัวช่วยเพิ่มที่พัก (Setup wizard)** | 1) ข้อมูลที่พัก → 2) ประเภทห้อง → 3) เพิ่มห้อง (เพิ่มทีละหลายห้องได้ เช่น 101–120) → 4) โหมดที่เปิดและราคา → 5) อัตราค่าน้ำ/ไฟ + เลขมิเตอร์เริ่มต้น → 6) มอบหมายพนักงาน · บันทึกเป็น draft ได้ เปิดใช้งานเมื่อครบ | 1 |
| M2-01 | CRUD Property | ชื่อ, **รหัสย่อ** (ใช้ในเลขที่เอกสาร เช่น `SKV`), ประเภท (Apartment / Hotel / House / Condo), ที่อยู่, เบอร์ติดต่อ, เวลาเช็กอิน/เอาต์, วันจดมิเตอร์ประจำเดือน, ข้อมูลผู้รับเงินบนเอกสาร (ถ้าต่างจากบริษัท) | 1 |
| M2-01a | สลับที่พัก | ตัวเลือกที่พักบนแถบด้านบน + มุมมอง "All properties" สำหรับ Dashboard/รายงาน | 1 |
| M2-01b | ปิดใช้งานที่พัก | `ARCHIVED` — ข้อมูลเดิมยังอยู่ แต่จองใหม่ไม่ได้ | 1 |
| M2-01c | คัดลอกการตั้งค่า | สร้างที่พักใหม่โดยคัดลอกประเภทห้อง/ราคา/ค่าบริการจากที่พักเดิม | 2 |
| M2-02 | CRUD RoomType | ชื่อ, ขนาด, จำนวนคนสูงสุด, สิ่งอำนวยความสะดวก, รูป | 1 |
| M2-03 | CRUD Unit | เลขห้อง, ชั้น, โหมดที่เปิด, สถานะ (ACTIVE / MAINTENANCE / INACTIVE) | 1 |
| M2-04 | ปิดห้องชั่วคราว (Block) | ซ่อม/ใช้เอง — ชนกับการจองโดยอัตโนมัติ | 1 |
| M2-05 | มิเตอร์ประจำห้อง | น้ำ/ไฟ, เลขเริ่มต้น, เปลี่ยนมิเตอร์ (reset เลข) | 1 |

### M3 — ราคา

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M3-01 | Rate plan รายวัน | ราคาฐาน, ราคาวันศุกร์–เสาร์, min/max nights | 1 |
| M3-02 | ราคาตามช่วงเวลา | high season / วันพิเศษ (ทับราคาฐาน) | 1 |
| M3-03 | ส่วนลดตามระยะพัก | พัก ≥ 7 / ≥ 28 คืน ลด X% | 2 |
| M3-05 | Rate plan รายปี | ค่าเช่า/เดือน, เงินประกัน (เดือน), ค่าเช่าล่วงหน้า (เดือน) | 1 |
| M3-06 | ค่าบริการเพิ่ม | ทำความสะอาด, คนเพิ่ม, ที่จอดรถ, เน็ต, เฟอร์นิเจอร์ — ต่อการจอง / ต่อคืน / ต่อเดือน / ตอนย้ายออก | 1 |
| M3-07 | อัตราค่าน้ำ/ไฟ | บาท/หน่วย, ค่าขั้นต่ำต่อเดือน, มีผลตั้งแต่วันที่ | 1 |
| M3-08 | การตั้งค่า VAT ตามประเภทรายการ | ยังไม่ทำ — ดูหัวข้อ 7.2 | 2 |
| M3-09 | ตัวคำนวณราคา (Quote) | คำนวณราคาแยกรายการ + แสดงตัวอย่างตารางงวดก่อนยืนยัน | 1 |
| M3-10 | ปรับราคาเอง | พนักงานแก้ราคา/ให้ส่วนลดตอนจองได้ (ต้องใส่เหตุผล, จำกัดตามบทบาท) | 1 |

### M4 — ปฏิทินและห้องว่าง

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M4-01 | ค้นหาห้องว่าง | ตามช่วงวันที่ / โหมด / จำนวนคน / ประเภทห้อง | 1 |
| M4-02 | ปฏิทินรวม (Tape chart) | แกนห้อง × วัน แสดงทุกโหมดและการ block | 1 |
| M4-03 | ห้องที่จะว่าง | สัญญาที่จะหมดใน 30/60/90 วัน | 1 |
| M4-04 | iCal export/import (Airbnb, Booking.com) | | 2 |

### M5 — การจอง (ทุกโหมด)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M5-01 | สร้างการจอง | **ขั้นที่ 1 เลือกโหมด** (Daily / Yearly) → ขั้นที่ 2 เลือกที่พัก, วันที่/ระยะเวลา (รายวัน = check-in/out · รายปี = วันเข้า + จำนวนปี), จำนวนคน → ขั้นที่ 3 เลือกห้องว่าง (แสดงเฉพาะห้องที่เปิดโหมดนั้น) → ขั้นที่ 4 ผู้เข้าพัก → ขั้นที่ 5 สรุปราคา + ตารางงวด → บันทึก | 1 |
| M5-02 | จองก่อน (Reserved) | สร้างการจองโดยยังไม่จ่ายได้ → `HOLD` (UI: **Reserved**) ล็อกห้อง + สร้างงวดทันที · กำหนดชำระ (`hold_expires_at`): รายวัน = เวลาเช็กอินของวันเข้าพัก (ค่าเริ่มต้น, ตั้งให้เร็วขึ้นได้) · รายปี = วันเข้าพัก · เตือนก่อนครบกำหนด 24 ชม. | 1 |
| M5-03 | ยืนยันการจอง | **รายวัน:** อัตโนมัติเมื่อจ่ายครบ · **รายปี:** อัตโนมัติเมื่อจ่ายงวดแรกเข้าครบ (เงินประกัน + ค่าเช่าล่วงหน้า) · Manager ยืนยันเองได้พร้อมเหตุผล | 1 |
| M5-04 | แก้ไข/ย้ายห้อง | ตรวจห้องว่างใหม่, คำนวณใหม่, ปรับงวดที่ยังไม่จ่าย | 1 |
| M5-05 | ขยายเวลา | รายวัน +คืน · รายปีใช้การต่อสัญญา (M6-04) | 1 |
| M5-06 | ยกเลิก | คำนวณยอดคืน/ริบตาม policy, งวดที่ยังไม่จ่าย → `CANCELLED` | 1 |
| M5-07 | Check-in | เวลาเข้าจริง, เอกสารยืนยันตัวตน, จดมิเตอร์ตอนเข้า (รายปี) · **รายวัน: ต้องไม่มียอดค้าง** (Manager override ได้พร้อมเหตุผล) | 1 |
| M5-08 | Check-out | เวลาออกจริง, จดมิเตอร์ตอนออก, ตรวจห้อง, สรุปยอดสุดท้าย | 1 |
| M5-09 | No-show | รายวันที่ไม่มาเช็กอิน | 1 |
| M5-10 | Cancellation policy | Flexible / Moderate / Strict / กำหนดเอง | 1 |
| ~~M5-10 เดิม~~ | ~~Booking engine สำหรับลูกค้า~~ | ตัดออก — พนักงานบันทึกเอง | – |

### M6 — สัญญาเช่า (รายปี)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M6-01 | สร้างสัญญาจากการจอง | ค่าเช่า, ระยะเวลา, เงินประกัน, ระยะแจ้งล่วงหน้า, เงื่อนไขค่าปรับ | 1 |
| M6-02 | เทมเพลตสัญญา → PDF | ตัวแปร `{{tenant_name}}`, `{{unit}}`, ... | 1 |
| M6-03 | แนบสัญญาที่เซ็นแล้ว | อัปโหลดไฟล์ | 1 |
| M6-04 | ต่อสัญญา | เตือนก่อนหมด, สร้างสัญญาใหม่ (ปรับราคาได้) เชื่อมสัญญาเดิม + ต่องวด | 1 |
| M6-05 | แจ้งย้ายออก | บันทึกวันแจ้ง/วันออก, ตรวจระยะแจ้งล่วงหน้า, ค่าปรับถ้าไม่ครบ | 1 |
| M6-06 | ยกเลิกสัญญาก่อนกำหนด | ค่าปรับ/ริบประกัน, ยกเลิกงวดอนาคต | 1 |
| M6-07 | Month-to-month อัตโนมัติหลังหมดสัญญา | | 2 |

### M7 — งวดและการรับเงิน (แทน M7 เดิม)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M7-01 | สร้างงวดอัตโนมัติ | ตอนยืนยันการจอง: รายวัน = 1 งวดทั้งการจอง · รายปี = งวดรายเดือน · + งวดแรกเข้า (เงินประกัน/ค่าแรกเข้า) | 1 |
| M7-02 | **ตารางสถานะงวด** | ดูทุกงวดของการจอง: ช่วงวันที่, ครบกำหนด, ยอด, จ่ายแล้ว, **วันที่จ่าย**, สถานะ | 1 |
| M7-03 | **บันทึกการรับเงิน** | ระบุยอด, **วันที่รับเงิน**, วิธี (เงินสด/โอน/เช็ค/อื่นๆ), เลขอ้างอิง, แนบสลิป (ไม่บังคับ), หมายเหตุ → ระบบตัดเข้างวดเก่าสุดก่อน หรือเลือกงวดเอง | 1 |
| M7-04 | รับเงินบางส่วน | งวดเป็น `PARTIAL` แสดงยอดคงเหลือ | 1 |
| M7-05 | ยกเลิกรายการรับเงิน | void พร้อมเหตุผล → งวดกลับเป็นสถานะเดิม, เอกสารที่ออกไปแล้วต้อง void ตาม | 1 |
| M7-06 | ยกเว้น/ลดยอดงวด | `WAIVED` หรือเพิ่มบรรทัดส่วนลด (ต้องใส่เหตุผล, MANAGER ขึ้นไป) | 1 |
| M7-07 | ค่าปรับจ่ายช้า | เกิน grace period → เพิ่มบรรทัด `LATE_FEE` (เหมา/ต่อวัน, ตั้งค่าได้, ปิดได้) | 1 |
| M7-08 | ภาษีหัก ณ ที่จ่าย | ผู้เช่าเป็นนิติบุคคลหัก 5%: บันทึกยอดหัก + เลขที่หนังสือรับรอง → ยอดงวดถือว่าจ่ายครบ (ไม่เกี่ยวกับ VAT จึงคงไว้) | 1 |
| M7-09 | เงินประกัน | รับ → ถือ → หักค่าเสียหาย (รายการ + รูป) → คืน / ออกบิลเพิ่มถ้าไม่พอ | 1 |
| M7-10 | ยอดค้างชำระ | รายการงวด OVERDUE แยกตามจำนวนวันที่ค้าง | 1 |
| ~~M7-05 เดิม~~ | ~~PromptPay / Payment gateway~~ | ตัดออก | – |

### M8 — จดมิเตอร์

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M8-01 | จดมิเตอร์ทั้งอาคาร | ทุกเดือนตามวันที่ตั้งไว้ กรอกเรียงห้อง (bulk), แนบรูปได้ | 1 |
| M8-02 | จดตอนเข้า/ออก | บังคับตอนเช็กอิน/เช็กเอาต์ของรายปี | 1 |
| M8-03 | ตรวจค่าผิดปกติ | เลขลดลง, ใช้มากกว่าค่าเฉลี่ย 3 เดือนเกิน X%, ห้องที่ยังไม่ได้จด | 1 |
| M8-04 | คิดค่าน้ำ/ไฟเข้างวด | หน่วยที่ใช้ × เรท (ไม่ต่ำกว่าค่าขั้นต่ำ) → บรรทัดในงวดถัดไป (หัวข้อ 6.4) | 1 |

### M9 — เอกสาร (Invoice / Receipt) — ภาษาอังกฤษ

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M9-01 | Invoice (ใบแจ้งหนี้) | ออกจากงวด (รายปี) หรือทั้งการจอง (รายวัน) | 1 |
| M9-02 | Receipt (ใบเสร็จ) | ออกจากรายการรับเงิน · แสดงงวดที่ชำระ, ยอด, วันที่รับเงิน, วิธีชำระ | 1 |
| M9-03 | ข้อมูลผู้จ่าย (Bill to) | ชื่อ/ที่อยู่/เลขผู้เสียภาษี (ถ้ามี) ดึงจากผู้เข้าพักหรือบริษัท แก้ได้ก่อนออก | 1 |
| M9-04 | เลขที่เอกสาร | ต่อเนื่อง **แยกตามที่พัก ประเภท และปี** เช่น `SKV-INV-2026-00001`, `SKV-RC-2026-00001` | 1 |
| M9-05 | Void + ออกใหม่ | ห้ามลบ ห้ามแก้หลังออกแล้ว | 1 |
| M9-06 | พิมพ์ / PDF | หน้า A4 สำหรับพิมพ์ + บันทึก PDF, พิมพ์ซ้ำมีคำว่า "COPY" | 1 |
| M9-07 | Tax Invoice / Credit Note / รายงานภาษีขาย | เมื่อเริ่มใช้ VAT | 2 |

### M10 — ผู้เข้าพัก/ผู้เช่า

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M10-01 | ข้อมูลผู้เข้าพัก | ชื่อ, เบอร์, อีเมล, LINE ID, สัญชาติ, ที่อยู่สำหรับออกเอกสาร (Bill to) | 1 |
| M10-02 | ผู้เช่าเป็นบริษัท | ชื่อบริษัท, เลขผู้เสียภาษี, สาขา (ใช้ออกเอกสารและคิดหัก ณ ที่จ่าย) | 1 |
| M10-03 | เอกสารยืนยันตัวตน | private storage, จำกัดสิทธิ์การดู | 1 |
| M10-04 | ผู้พักร่วม | | 1 |
| M10-05 | ประวัติ & Blacklist | | 2 |
| M10-06 | รายงาน ตม.30 | | 2 |

### M11 — ปฏิบัติการและแจ้งเตือน

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M11-01 | Dashboard วันนี้ | เข้า/ออกวันนี้, ห้องว่าง, งวดถึงกำหนด/เกินกำหนด, สัญญาใกล้หมด, ห้องที่ยังไม่จดมิเตอร์ | 1 |
| M11-02 | แจ้งเตือนในแอป | กระดิ่งแจ้งเตือน (ฟรี ไม่จำกัด) | 1 |
| M11-03 | **สรุปรายวันทาง LINE เข้ากลุ่มพนักงาน** | ส่ง 1 ข้อความ/วัน (หัวข้อ 8) | 1 |
| M11-04 | แจ้งเตือนผู้เช่าทาง LINE | เตือนบิล/ครบกำหนด (ใช้โควตา — ปิด/เปิดได้) | 2 |
| M11-05 | Housekeeping / แจ้งซ่อม | | 2 |

### M12 — รายงาน

| ID | ฟังก์ชัน | P |
|---|---|---|
| M12-01 | อัตราการเข้าพัก (แยกโหมด/ประเภทห้อง/ช่วงเวลา) | 1 |
| M12-02 | รายรับ (ตามวันที่รับเงินจริง) แยกค่าเช่า/น้ำ/ไฟ/บริการ/โหมด | 1 |
| M12-03 | ยอดค้างชำระ & เงินประกันคงค้าง | 1 |
| M12-04 | รายงานภาษีขาย (เมื่อเริ่มใช้ VAT) | 2 |
| M12-07 | เปรียบเทียบระหว่างที่พัก (occupancy / รายรับ / ยอดค้าง) | 1 |
| M12-05 | Export CSV/Excel | 1 |
| M12-06 | ADR / RevPAR (รายวัน) | 2 |

### M13 — ระบบ

| ID | ฟังก์ชัน | P |
|---|---|---|
| M13-01 | Audit log | 1 |
| M13-02 | งานอัตโนมัติตามเวลา (หัวข้อ 10) | 1 |
| M13-03 | ไฟล์ (สลิป, สัญญา, เอกสาร, รูปมิเตอร์) บน Supabase Storage | 1 |

---

## 4. State Machines

### Booking
```
 (create) → HOLD ── confirm ──> CONFIRMED ── check-in ──> CHECKED_IN ── check-out ──> CHECKED_OUT ── settle ──> CLOSED
             │  └── expire ──> EXPIRED      │  └── no-show (รายวัน) ──> NO_SHOW
             └── cancel ──> CANCELLED <──────┘
```
- สถานะที่ **ครองห้อง**: `HOLD`, `CONFIRMED`, `CHECKED_IN`
- `CLOSED` = ทุกงวด PAID/WAIVED และเคลียร์เงินประกันแล้ว

### Lease
`DRAFT → ACTIVE → NOTICE_GIVEN → ENDED` · `ACTIVE → TERMINATED` · `ACTIVE → RENEWED` (ชี้ไปสัญญาใหม่)

### Charge Period (สถานะกำกับแต่ละวัน/เดือน)
```
UPCOMING ──(ถึงวันครบกำหนด − N วัน)──> DUE ──(เลยวันครบกำหนด)──> OVERDUE
    │                                   │                          │
    └──────────── รับเงินบางส่วน ─────────┴──────> PARTIAL ──────────┤
                                                                   │
                               รับเงินครบ ──> PAID   ·   ยกเว้น ──> WAIVED   ·   ยกเลิกการจอง ──> CANCELLED
```

| สถานะ | สี (แนะนำ) | ความหมาย |
|---|---|---|
| `UPCOMING` | เทา | ยังไม่ถึงรอบ |
| `DUE` | ฟ้า | ถึงรอบเรียกเก็บแล้ว ยังไม่เลยกำหนด |
| `PARTIAL` | เหลือง | จ่ายบางส่วน |
| `OVERDUE` | แดง | เลยกำหนด ยังจ่ายไม่ครบ |
| `PAID` | เขียว | จ่ายครบ (แสดงวันที่จ่าย) |
| `WAIVED` | ม่วง | ยกเว้น/ไม่เก็บ |
| `CANCELLED` | ขีดฆ่า | งวดถูกยกเลิก |

สถานะ **คำนวณจากยอดเงินและวันที่** (ไม่ให้พนักงานเปลี่ยนเองตรงๆ) ยกเว้น `WAIVED`

### Document
`ISSUED → VOID` (ไม่มี draft — ออกแล้วถือว่าออก)

---

## 5. การบันทึกการรับเงินและสถานะรายงวด (รายละเอียด)

### 5.1 การสร้างงวด

| โหมด | งวด | วันครบกำหนด (ค่าเริ่มต้น) |
|---|---|---|
| รายวัน | งวดที่ 1: ทั้งการจอง `[check_in, check_out)` (ค่าห้อง + ค่าบริการ) · ขยายคืน → งวดเพิ่ม | ก่อนเข้าพัก (= วันหมดอายุของ Hold) |
| รายปี | งวดที่ 0: เงินประกัน + ค่าแรกเข้า · งวดที่ 1..12N: ค่าเช่ารายเดือน `[วันเข้า + (n−1) เดือน, วันเข้า + n เดือน)` | วันแรกของงวด (+ grace days) |

- **ค่าเช่าล่วงหน้า M เดือน** = งวดที่ 1..M มีวันครบกำหนดเป็นวันทำสัญญา
- **วันที่ 29–31:** ถ้าเดือนนั้นไม่มีวันที่ดังกล่าว ใช้วันสุดท้ายของเดือน (เข้า 31 ม.ค. → งวดถัดไป 28/29 ก.พ. → 31 มี.ค.)
- **รายวันจองก่อน จ่ายก่อนเข้าพัก:** จองล่วงหน้าได้ (Reserved) และจ่ายเมื่อไรก็ได้จนถึงกำหนด · ถ้าไม่จ่ายครบภายในกำหนด การจองหมดอายุและห้องว่างทันที · จ่ายบางส่วนได้ แต่สถานะยังเป็น `HOLD` จนจ่ายครบ (Manager ขยายเวลา Hold ได้)

### 5.2 ขั้นตอนบันทึกรับเงิน

```
1. เปิดการจอง → ดูตารางงวด (สถานะ + ยอดคงเหลือ)
2. กด "Record payment"
3. กรอก: ยอดเงิน, วันที่รับเงิน (ค่าเริ่มต้น = วันนี้, ย้อนหลังได้), วิธีชำระ, เลขอ้างอิง, สลิป (optional), หัก ณ ที่จ่าย (optional)
4. เลือกการตัดยอด: [อัตโนมัติ: งวดเก่าสุดก่อน] หรือ [เลือกงวดเอง]
5. บันทึก (transaction เดียว): payments + payment_allocations + อัปเดตยอด/สถานะงวด + audit log
6. ถามว่าจะออก Receipt เลยไหม → ออกเลขที่ + PDF
```

- รับเงินเกินยอด → เก็บเป็น **เครดิตคงเหลือ** ของการจอง ใช้ตัดงวดถัดไปได้
- วันที่ `paid_at` ของงวด = วันที่ของรายการรับเงินที่ทำให้งวดนั้นจ่ายครบ

### 5.3 มุมมองสถานะ (สำหรับออกแบบหน้าจอ)
- **ในการจอง:** ตารางงวดพร้อม badge สถานะ
- **ภาพรวม (Payment status board):** แกนห้อง × เดือน (รายปี) หรือ ห้อง × วัน (รายวัน) แต่ละช่องเป็นสีตามสถานะงวด

---

## 6. กฎการคำนวณราคา

### 6.1 รายวัน
```
for each night in [check_in, check_out):
    price = date_override ?? seasonal_rate ?? (isFriSat ? weekend_rate : base_rate)
subtotal = Σ price − LOS discount (เฟส 2)
fees     = cleaning + extra guest × nights + add-ons
total    = subtotal + fees   (MVP ไม่คิด VAT)
```
ตรวจ min/max nights, max occupancy · ถ้าพักนานมาก (≥ 28 คืน) แสดงคำแนะนำให้พิจารณาสัญญารายปี

### 6.2 รายปี (รอบบิลตามวันเข้าพัก)
- สัญญา N ปี · ค่าเช่ากำหนดต่อเดือน (หรือต่อปีแล้วระบบหาร 12)
- **จ่ายรายเดือนเท่านั้น**
- ไม่มีการคิดตามสัดส่วน — ทุกงวดเต็มรอบนับจากวันเข้า
- งวดรายเดือน = ค่าเช่า + ค่าบริการรายเดือน + ค่าน้ำ/ไฟของรอบก่อน (6.4)
- **ออกก่อนกำหนด/ออกกลางงวด:** งวดสุดท้ายตั้งค่าได้ `FULL_PERIOD` (ค่าเริ่มต้น) หรือ `DAILY_PRORATE` + ค่าปรับตาม `early_termination_rule` (เช่น ริบเงินประกัน หรือ ค่าเช่า X เดือน)

### 6.4 ค่าน้ำ/ไฟตามมิเตอร์
- **จดทั้งอาคารเดือนละครั้ง** ตามวันที่ตั้งไว้ (เช่น วันที่ 25) + จดตอนเข้า/ออก
- หน่วยที่ใช้ = เลขครั้งนี้ − เลขครั้งก่อนในช่วงที่ผู้เช่าอยู่ (ถ้าเปลี่ยนมิเตอร์ ใช้เลขเริ่มต้นของมิเตอร์ใหม่)
- ยอด = max(หน่วย × เรท, ค่าขั้นต่ำ) โดยใช้เรทที่มีผล ณ วันจด
- **นำเข้างวด:** เพิ่มเป็นบรรทัด `WATER` / `ELECTRIC` ในงวดค่าเช่าถัดไปที่ยังไม่ PAID · ถ้าไม่มีงวดถัดไป (เดือนสุดท้าย) สร้างงวด `MOVE_OUT`
- **ตอนย้ายออก:** มิเตอร์ตอนออก → บรรทัดในงวดสุดท้าย หรือหักจากเงินประกัน

### 6.5 Cancellation policy (รายวัน)
เก็บเป็น rules `[{days_before, refund_percent}]` และเก็บสำเนา (snapshot) ไว้ในการจอง

---

## 7. Invoice และ Receipt

### 7.1 MVP (ไม่มี VAT)
- **Invoice:** หัวเอกสาร (ข้อมูลที่พัก/บริษัท + โลโก้), Bill to, เลขที่, วันที่ออก, วันครบกำหนด, ห้อง/การจอง, รายการ (งวด, ค่าเช่า, ค่าน้ำ/ไฟพร้อมเลขมิเตอร์, ค่าบริการ, ค่าปรับ, ส่วนลด), ยอดรวม, ยอดค้างยกมา, ช่องทางการชำระ (เลขบัญชี/QR ที่ host ตั้งไว้ — เป็นรูปภาพ ไม่มีการชำระออนไลน์)
- **Receipt:** เลขที่, วันที่รับเงิน, ได้รับจาก, รายการงวดที่ชำระ, ยอดรับ, หัก ณ ที่จ่าย (ถ้ามี), วิธีชำระ/เลขอ้างอิง, ผู้รับเงิน
- **ภาษา:** ภาษาอังกฤษ · ตัวเลขเงินแสดงเป็น `THB 12,500.00` + จำนวนเงินเป็นตัวอักษรภาษาอังกฤษ
- เอกสารเก็บ snapshot ข้อมูลทั้งหมดตอนออก (แก้ข้อมูลภายหลังไม่กระทบเอกสารเดิม)

### 7.2 เฟส 2: VAT (ออกแบบเผื่อไว้)
- เพิ่ม `vat_mode` ต่อประเภทรายการ, ตั้งค่า `vat_registered` ระดับธุรกิจ, เอกสาร Receipt / Tax Invoice + Credit Note, รายงานภาษีขาย
- ⚠️ ใบกำกับภาษีตามกฎหมายไทยต้องมีภาษาไทย (หรือได้รับอนุญาต) → ตอนเริ่มใช้ VAT ต้องทำเอกสารภาษีเป็น 2 ภาษา และควรยืนยันการคิด VAT แต่ละประเภทรายการกับนักบัญชี (ค่าที่พักรายวันกับค่าเช่าที่อยู่อาศัยระยะยาวมีกฎต่างกัน)
- schema MVP ไม่มีคอลัมน์ VAT แต่โครงสร้าง `charge_lines` / `documents` เพิ่มคอลัมน์ได้โดยไม่กระทบข้อมูลเดิม

---

## 8. แจ้งเตือนทาง LINE แบบฟรี

> **LINE Notify ปิดบริการไปแล้ว (31 มี.ค. 2025)** จึงใช้ **LINE Official Account + Messaging API** แทน

| ประเภทข้อความ | ค่าใช้จ่าย | ใช้ทำอะไร |
|---|---|---|
| **Reply message** (ตอบกลับเมื่อผู้ใช้ส่งข้อความมาก่อน) | ฟรี ไม่นับโควตา | พนักงานพิมพ์ `today` / `overdue` ในกลุ่ม → บอทตอบสรุป |
| **Push message** (ระบบส่งเอง) | นับโควตาของแผนฟรีรายเดือน (นับตามจำนวนผู้รับ) | สรุปรายวันเข้ากลุ่มพนักงาน |

**แผนสำหรับ MVP (ไม่เสียเงิน)**
1. เพิ่มบอท LINE OA เข้า **กลุ่ม LINE ของพนักงาน**
2. **08:00 ทุกวัน** ส่ง 1 ข้อความสรุป: เช็กอิน/เอาต์วันนี้, งวดครบกำหนดวันนี้, งวดเกินกำหนด, hold ใกล้หมดอายุ, สัญญาจะหมดใน 30 วัน, ห้องที่ยังไม่จดมิเตอร์ (ถ้าถึงวันจด)
3. พิมพ์คำสั่งในกลุ่ม (`today`, `overdue`, `room 101`) → ตอบกลับฟรี
4. เรื่องด่วนอื่นๆ แสดงใน **กระดิ่งแจ้งเตือนในแอป** (ฟรี ไม่จำกัด)
5. ระบบ **นับจำนวน push ที่ใช้ไปในเดือน** และหยุดส่ง push อัตโนมัติก่อนโควตาหมด (กลับไปใช้ในแอปอย่างเดียว)

**ข้อควรทราบ**
- โควตาฟรีของ LINE OA ในไทยมีจำนวนจำกัดต่อเดือน (ตรวจตัวเลขปัจจุบันใน LINE OA Manager) และ push เข้ากลุ่มนับตามจำนวนสมาชิก → กลุ่ม 5 คน × 30 วัน ≈ 150 ข้อความ/เดือน
- การแจ้งเตือน **ผู้เช่า** ทาง LINE จะใช้โควตาเร็ว จึงอยู่เฟส 2 (เปิด/ปิดได้)

---

## 9. การใช้ Supabase

| ส่วน | การใช้งาน |
|---|---|
| **Database** | Postgres + extensions `btree_gist`, `citext`, `pgcrypto`, `pg_cron` · migration ด้วย Supabase CLI (`supabase/migrations/*.sql`) |
| **Auth** | **Google OAuth อย่างเดียว** (ปิด email/password) · PKCE flow ผ่าน `@supabase/ssr` → route `/auth/callback` · ตรวจ allowlist ด้วย **Auth Hook "Before User Created"** (ปฏิเสธอีเมลที่ไม่อยู่ใน `team_members`) และตรวจซ้ำใน middleware ทุก request (`is_active`) · ตาราง `profiles` ผูกกับ `auth.users` |
| **Realtime** | Supabase Realtime: subscribe การเปลี่ยนแปลง `bookings`, `charge_periods`, `payments` ของที่พักที่เปิดอยู่ (ผ่าน RLS) · Presence channel ต่อการจองเพื่อแสดงคนที่กำลังเปิดดู |
| **RLS** | เปิดทุกตาราง · policy ตาม role ผ่านฟังก์ชัน `app.current_role()` · ฝั่ง client อ่านได้เฉพาะที่จำเป็น การเขียนทั้งหมดผ่าน server |
| **Data access ฝั่ง server** | **Drizzle ORM** + `postgres` (postgres.js) ต่อผ่าน **Cloudflare Hyperdrive** → Supabase (direct connection) สำหรับ business logic ที่ต้องใช้ transaction · ใช้ `@supabase/ssr` สำหรับ session/auth |
| **Storage** | Private buckets: `slips`, `id-documents`, `contracts`, `documents` (PDF), `meter-photos` · เข้าถึงผ่าน signed URL อายุสั้น |
| **Scheduled jobs** | `pg_cron` สำหรับงาน SQL ล้วน · งานที่ต้องใช้ TypeScript (ส่ง LINE) ใช้ **Cloudflare Cron Triggers** (หัวข้อ 9.1) |
| **Region** | Singapore (`ap-southeast-1`) ใกล้ไทยที่สุด |
| **Backup** | Free plan ไม่มี PITR และ **โปรเจกต์ถูกพักเมื่อไม่มีการใช้งาน 7 วัน** → สำหรับใช้งานจริงแนะนำ Pro plan |

### 9.1 Deploy บน Cloudflare

| ส่วน | การใช้งาน |
|---|---|
| **Next.js runtime** | Cloudflare Workers ผ่าน `@opennextjs/cloudflare` (เปิด `nodejs_compat`) · ไม่ใช้ `@cloudflare/next-on-pages` (เลิกพัฒนาแล้ว) |
| **DB connection** | **Hyperdrive** ทำ connection pooling + ลด latency จาก Workers ไป Supabase · ใช้ `env.HYPERDRIVE.connectionString` สร้าง client ต่อ request |
| **Cron** | Worker แยกตัวเล็ก (`cron-worker`) ใช้ Cron Triggers เรียก `/api/cron/daily-digest` พร้อม secret (เวลาเป็น UTC → 08:00 ไทย = `0 1 * * *`) |
| **PDF** | Workers ไม่มี Chromium และไลบรารีสร้าง PDF ฝั่ง server ใช้กับ Workers ได้จำกัด → แสดงเอกสารเป็น **หน้า HTML ขนาด A4** (print CSS) แล้วสร้าง PDF **ฝั่ง browser** (`@react-pdf/renderer`) แล้วอัปโหลดเก็บ · ข้อมูลจริงของเอกสารอยู่ใน `documents` (snapshot) เสมอ |
| **LINE webhook** | Route Handler บน Workers ตรวจ `x-line-signature` ด้วย Web Crypto (HMAC-SHA256) |
| **Secrets** | `wrangler secret put` — Supabase service key, LINE channel secret/token, CRON_SECRET |
| **Domain / Security** | ใช้ Cloudflare DNS + SSL · ตัวเลือก: **Cloudflare Access** ครอบหน้า admin (ฟรีสูงสุด 50 ผู้ใช้) เป็นชั้นป้องกันเพิ่ม |
| **รูปภาพ/ไฟล์** | เก็บใน Supabase Storage (เข้ากับ RLS) · ย้ายไป Cloudflare R2 ได้ภายหลังถ้าต้องการลดค่า egress |
| **แผนที่ใช้** | แนะนำ **Workers Paid (~USD 5/เดือน)**: แผนฟรีจำกัดขนาด bundle และ CPU time ต่อ request ซึ่งแอป Next.js ขนาดนี้มักเกิน (ตรวจตัวเลขล่าสุดในหน้า pricing ของ Cloudflare) |
| **Local dev** | `next dev` ปกติ + `opennextjs-cloudflare preview` ก่อน deploy เพื่อทดสอบบน runtime ของ Workers |

---

## 10. งานอัตโนมัติ (Scheduled Jobs)

| Job | ความถี่ | ทำงานที่ | หน้าที่ |
|---|---|---|---|
| `expire_holds` | ทุก 5 นาที | pg_cron (SQL) | HOLD ที่หมดเวลา → EXPIRED |
| `refresh_period_status` | ทุกวัน 00:05 | pg_cron (SQL) | UPCOMING→DUE, DUE/PARTIAL→OVERDUE |
| `apply_late_fees` | ทุกวัน 00:10 | pg_cron (SQL) | เพิ่ม/อัปเดตบรรทัด LATE_FEE (idempotent ต่องวด) |
| `mark_no_show` | ทุกวัน (หลังเวลาตัด) | pg_cron (SQL) | รายวันที่ไม่เช็กอิน → NO_SHOW |
| `lease_lifecycle` | ทุกวัน | pg_cron (SQL) | สัญญาถึงวันสิ้นสุด → ENDED |
| `daily_digest` | ทุกวัน 08:00 (เวลาไทย) | Cloudflare Cron → `/api/cron/daily-digest` | ส่งสรุปเข้ากลุ่ม LINE (แยกตามที่พัก) + แจ้งเตือนในแอป |
| `ical_sync` | ทุก 15 นาที | เฟส 2 | |

ทุก job ต้อง **idempotent** (รันซ้ำแล้วผลเหมือนเดิม) · หมายเหตุ: pg_cron ใช้เวลา UTC → 08:00 ไทย = `0 1 * * *`

---

## 11. Database Schema (PostgreSQL / Supabase — ร่าง)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE rental_mode     AS ENUM ('DAILY','YEARLY');
CREATE TYPE booking_status  AS ENUM ('HOLD','CONFIRMED','CHECKED_IN','CHECKED_OUT','CLOSED','CANCELLED','NO_SHOW','EXPIRED');
CREATE TYPE booking_kind    AS ENUM ('RESERVATION','BLOCK');
CREATE TYPE lease_status    AS ENUM ('DRAFT','ACTIVE','NOTICE_GIVEN','ENDED','TERMINATED','RENEWED');
CREATE TYPE period_kind     AS ENUM ('STAY','MOVE_IN','RENT','MOVE_OUT','ADJUSTMENT');
CREATE TYPE period_status   AS ENUM ('UPCOMING','DUE','PARTIAL','OVERDUE','PAID','WAIVED','CANCELLED');
CREATE TYPE doc_type        AS ENUM ('INVOICE','RECEIPT');   -- เฟส 2 เพิ่ม TAX_INVOICE, CREDIT_NOTE
CREATE TYPE user_role       AS ENUM ('ADMIN','MANAGER','FRONT_DESK','ACCOUNTANT');

-- ===== ผู้ใช้ & ตั้งค่า =====
CREATE TABLE team_members (               -- allowlist: ใครเข้าระบบได้ (สร้างก่อนเขา login ครั้งแรก)
  email        citext PRIMARY KEY,          -- อีเมล Google
  full_name    text,
  role         user_role NOT NULL DEFAULT 'FRONT_DESK',
  is_active    boolean NOT NULL DEFAULT true,
  added_by     uuid,
  added_at     timestamptz NOT NULL DEFAULT now(),
  user_id      uuid UNIQUE REFERENCES auth.users(id),  -- เติมเมื่อ login ครั้งแรก
  last_sign_in timestamptz
);

CREATE TABLE profiles (                    -- สร้างอัตโนมัติจาก team_members ตอน login ครั้งแรก
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      citext UNIQUE NOT NULL REFERENCES team_members(email),
  full_name  text NOT NULL,                -- ดึงจาก Google profile
  avatar_url text,
  role       user_role NOT NULL DEFAULT 'FRONT_DESK',
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_settings (           -- มีแถวเดียว
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  legal_name         text NOT NULL,
  address            text NOT NULL,
  tax_id             text,
  hold_hours         int  NOT NULL DEFAULT 24,
  line_push_monthly_limit int NOT NULL DEFAULT 200,
  logo_file_id       uuid
);

-- ===== ที่พัก & ห้อง =====
CREATE TABLE properties (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text UNIQUE NOT NULL CHECK (code ~ '^[A-Z0-9]{2,6}$'),  -- ใช้ในเลขที่เอกสาร
  name                 text NOT NULL,
  type                 text NOT NULL DEFAULT 'APARTMENT' CHECK (type IN ('APARTMENT','HOTEL','HOUSE','CONDO','OTHER')),
  status               text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  address              text,
  phone                text,
  issuer_override      jsonb,             -- ชื่อ/ที่อยู่/เลขผู้เสียภาษีบนเอกสาร ถ้าต่างจากบริษัท
  payment_instructions text,              -- เลขบัญชีบน Invoice
  payment_qr_file_id   uuid,
  line_group_id        text,              -- กลุ่ม LINE ของพนักงานที่พักนี้ (ใช้กลุ่มเดียวกันได้)
  check_in_time        time NOT NULL DEFAULT '14:00',
  check_out_time       time NOT NULL DEFAULT '12:00',
  meter_reading_day    int  NOT NULL DEFAULT 25 CHECK (meter_reading_day BETWEEN 1 AND 28),
  grace_days           int  NOT NULL DEFAULT 5,
  late_fee_rule        jsonb,             -- {type:'PER_DAY'|'FLAT', amount, max_amount}
  move_out_billing     text NOT NULL DEFAULT 'FULL_PERIOD' CHECK (move_out_billing IN ('FULL_PERIOD','DAILY_PRORATE')),
  turnover_buffer_days int  NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE property_staff (              -- สิทธิ์รายที่พัก (ADMIN เห็นทุกที่โดยไม่ต้องมีแถว)
  property_id uuid REFERENCES properties(id),
  user_id     uuid REFERENCES profiles(id),
  PRIMARY KEY (property_id, user_id)
);

CREATE TABLE room_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES properties(id),
  name          text NOT NULL,
  max_occupancy int  NOT NULL,
  size_sqm      numeric(6,2),
  amenities     text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE units (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES properties(id),
  room_type_id  uuid NOT NULL REFERENCES room_types(id),
  code          text NOT NULL,
  floor         text,
  allowed_modes rental_mode[] NOT NULL DEFAULT '{DAILY}',
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MAINTENANCE','INACTIVE')),
  UNIQUE (property_id, code)
);

-- ===== ราคา =====
CREATE TABLE cancellation_policies (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name  text NOT NULL,
  rules jsonb NOT NULL          -- [{days_before:14, refund_percent:100}, ...]
);

CREATE TABLE rate_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id     uuid NOT NULL REFERENCES room_types(id),
  mode             rental_mode NOT NULL,
  name             text NOT NULL,
  base_amount      bigint NOT NULL,       -- สตางค์: ต่อคืน / ต่อเดือน / ต่อปี
  weekend_amount   bigint,                -- DAILY
  min_length       int NOT NULL DEFAULT 1,
  max_length       int,
  deposit_months   numeric(4,2),
  advance_months   int,
  cancellation_policy_id uuid REFERENCES cancellation_policies(id),
  is_active        boolean NOT NULL DEFAULT true
);

CREATE TABLE rate_overrides (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_plan_id uuid NOT NULL REFERENCES rate_plans(id),
  during       daterange NOT NULL,
  amount       bigint NOT NULL,
  priority     int NOT NULL DEFAULT 0
);

CREATE TABLE charge_types (              -- ประเภทรายการ (เฟส 2 เพิ่มคอลัมน์ VAT ที่นี่)
  code        text PRIMARY KEY,           -- NIGHTLY, RENT, WATER, ELECTRIC, CLEANING, PARKING, FURNITURE, LATE_FEE, DEPOSIT ...
  name        text NOT NULL,
  is_revenue  boolean NOT NULL DEFAULT true   -- DEPOSIT = false
);

CREATE TABLE fees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES properties(id),
  charge_type  text NOT NULL REFERENCES charge_types(code),
  name         text NOT NULL,
  amount       bigint NOT NULL,
  basis        text NOT NULL CHECK (basis IN ('PER_BOOKING','PER_NIGHT','PER_MONTH','PER_GUEST_NIGHT','ON_MOVE_OUT')),
  applies_to   rental_mode[] NOT NULL,
  is_optional  boolean NOT NULL DEFAULT false
);

CREATE TABLE utility_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES properties(id),
  utility        text NOT NULL CHECK (utility IN ('WATER','ELECTRIC')),
  price_per_unit bigint NOT NULL,
  minimum_charge bigint NOT NULL DEFAULT 0,
  effective_from date NOT NULL,
  UNIQUE (property_id, utility, effective_from)
);

-- ===== ผู้เข้าพัก =====
CREATE TABLE guests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text NOT NULL,
  phone           text,
  email           citext,
  line_id         text,
  nationality     char(2),
  billing_name    text,           -- ชื่อบนเอกสาร (บุคคล/บริษัท)
  billing_address text,
  billing_tax_id  text,
  billing_branch  text,
  is_company      boolean NOT NULL DEFAULT false,
  id_doc_type     text,
  id_doc_number   text,           -- จำกัดสิทธิ์อ่านด้วย RLS/column privilege
  id_doc_file_id  uuid,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ===== การจอง =====
CREATE TABLE bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text UNIQUE NOT NULL,          -- SKV-BK-2026-000123
  property_id      uuid NOT NULL REFERENCES properties(id),  -- denormalize เพื่อ filter/RLS เร็ว
  unit_id          uuid NOT NULL REFERENCES units(id),
  kind             booking_kind NOT NULL DEFAULT 'RESERVATION',
  mode             rental_mode,
  status           booking_status NOT NULL,
  stay             daterange NOT NULL,            -- [check_in, check_out)
  guest_id         uuid REFERENCES guests(id),
  adults           int NOT NULL DEFAULT 1,
  children         int NOT NULL DEFAULT 0,
  rate_plan_id     uuid REFERENCES rate_plans(id),
  price_snapshot   jsonb,
  policy_snapshot  jsonb,
  total_amount     bigint NOT NULL DEFAULT 0,
  credit_balance   bigint NOT NULL DEFAULT 0,     -- รับเงินเกิน
  hold_expires_at  timestamptz,
  source           text NOT NULL DEFAULT 'DIRECT', -- DIRECT, WALK_IN, PHONE, LINE, AIRBNB, BOOKING_COM
  block_reason     text,
  idempotency_key  text UNIQUE,
  actual_check_in  timestamptz,
  actual_check_out timestamptz,
  version          int NOT NULL DEFAULT 1,
  created_by       uuid REFERENCES profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (lower(stay) < upper(stay)),
  CHECK (kind = 'BLOCK' OR (mode IS NOT NULL AND guest_id IS NOT NULL)),
  CONSTRAINT no_overlap EXCLUDE USING gist (unit_id WITH =, stay WITH &&)
    WHERE (status IN ('HOLD','CONFIRMED','CHECKED_IN'))
);
CREATE INDEX ON bookings (status);
CREATE INDEX ON bookings USING gist (stay);
CREATE INDEX ON bookings (hold_expires_at) WHERE status = 'HOLD';

CREATE TABLE booking_status_history (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  from_status booking_status,
  to_status   booking_status NOT NULL,
  reason      text,
  changed_by  uuid REFERENCES profiles(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE booking_occupants (
  booking_id uuid REFERENCES bookings(id),
  guest_id   uuid REFERENCES guests(id),
  PRIMARY KEY (booking_id, guest_id)
);

-- ===== สัญญา =====
CREATE TABLE leases (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             uuid UNIQUE NOT NULL REFERENCES bookings(id),
  status                 lease_status NOT NULL DEFAULT 'DRAFT',
  start_date             date NOT NULL,
  end_date               date NOT NULL,           -- exclusive
  rent_amount            bigint NOT NULL,         -- ต่อเดือน
  deposit_amount         bigint NOT NULL DEFAULT 0,
  notice_days            int NOT NULL DEFAULT 30,
  early_termination_rule jsonb,
  previous_lease_id      uuid REFERENCES leases(id),
  signed_file_id         uuid,
  notice_given_on        date,
  planned_move_out       date
);

-- ===== งวด (สถานะรายวัน / รายงวดของสัญญารายปี) =====
CREATE TABLE charge_periods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  seq          int  NOT NULL,                     -- 0 = แรกเข้า
  kind         period_kind NOT NULL,
  period       daterange,                         -- คืน/เดือน/งวด ที่ครอบคลุม
  due_date     date NOT NULL,
  total_amount bigint NOT NULL DEFAULT 0,         -- = Σ charge_lines (อัปเดตด้วย trigger)
  paid_amount  bigint NOT NULL DEFAULT 0,         -- = Σ allocations ที่ไม่ void
  status       period_status NOT NULL DEFAULT 'UPCOMING',
  paid_at      date,                              -- วันที่จ่ายครบ
  waived_reason text,
  UNIQUE (booking_id, seq)
);
CREATE INDEX ON charge_periods (status, due_date);

CREATE TABLE charge_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id   uuid NOT NULL REFERENCES charge_periods(id),
  charge_type text NOT NULL REFERENCES charge_types(code),
  description text NOT NULL,
  quantity    numeric(12,2) NOT NULL DEFAULT 1,
  unit_price  bigint NOT NULL,
  amount      bigint NOT NULL,                    -- ติดลบ = ส่วนลด
  meta        jsonb                               -- {meter_from, meter_to, reading_ids}
);

-- ===== มิเตอร์ =====
CREATE TABLE meters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     uuid NOT NULL REFERENCES units(id),
  utility     text NOT NULL CHECK (utility IN ('WATER','ELECTRIC')),
  serial_no   text,
  installed_on date NOT NULL,
  initial_value numeric(12,2) NOT NULL DEFAULT 0,
  retired_on  date
);

CREATE TABLE meter_readings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id      uuid NOT NULL REFERENCES meters(id),
  reading_date  date NOT NULL,
  value         numeric(12,2) NOT NULL,
  reading_type  text NOT NULL CHECK (reading_type IN ('MOVE_IN','MONTHLY','MOVE_OUT')),
  booking_id    uuid REFERENCES bookings(id),
  billed_line_id uuid REFERENCES charge_lines(id),  -- คิดเงินแล้วหรือยัง
  photo_file_id uuid,
  recorded_by   uuid REFERENCES profiles(id),
  UNIQUE (meter_id, reading_date, reading_type)
);

-- ===== รับเงิน =====
CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings(id),
  amount          bigint NOT NULL CHECK (amount > 0),   -- ยอดที่ได้รับจริง
  wht_amount      bigint NOT NULL DEFAULT 0,             -- หัก ณ ที่จ่าย
  wht_cert_no     text,
  paid_at         date NOT NULL,                         -- วันที่รับเงิน
  method          text NOT NULL CHECK (method IN ('CASH','TRANSFER','CHEQUE','CARD','OTHER')),
  reference       text,
  slip_file_id    uuid,
  note            text,
  idempotency_key text UNIQUE,
  recorded_by     uuid REFERENCES profiles(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  voided_at       timestamptz,
  void_reason     text
);

CREATE TABLE payment_allocations (
  payment_id uuid REFERENCES payments(id),
  period_id  uuid REFERENCES charge_periods(id),
  amount     bigint NOT NULL CHECK (amount > 0),   -- รวม wht ที่ตัดเข้างวดนี้
  PRIMARY KEY (payment_id, period_id)
);

CREATE TABLE refunds (                       -- คืนเงิน (ยกเลิก/คืนประกัน)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  amount      bigint NOT NULL CHECK (amount > 0),
  refunded_at date NOT NULL,
  method      text NOT NULL,
  reason      text NOT NULL,
  recorded_by uuid REFERENCES profiles(id)
);

-- ===== เงินประกัน =====
CREATE TABLE deposits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid UNIQUE NOT NULL REFERENCES bookings(id),
  amount     bigint NOT NULL,
  status     text NOT NULL DEFAULT 'PENDING'
             CHECK (status IN ('PENDING','HELD','PARTIALLY_REFUNDED','REFUNDED','FORFEITED')),
  settled_at date,
  refund_id  uuid REFERENCES refunds(id)
);

CREATE TABLE deposit_deductions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id     uuid NOT NULL REFERENCES deposits(id),
  reason         text NOT NULL,
  amount         bigint NOT NULL,
  photo_file_ids uuid[] NOT NULL DEFAULT '{}'
);

-- ===== เอกสาร =====
CREATE TABLE documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           doc_type NOT NULL,
  number         text UNIQUE NOT NULL,            -- SKV-RC-2026-00001
  property_id    uuid NOT NULL REFERENCES properties(id),
  booking_id     uuid NOT NULL REFERENCES bookings(id),
  payment_id     uuid REFERENCES payments(id),    -- Receipt
  period_ids     uuid[],                          -- Invoice
  ref_document_id uuid REFERENCES documents(id),  -- ใบที่ออกแทนใบที่ void
  issue_date     date NOT NULL,
  due_date       date,                            -- Invoice
  issuer         jsonb NOT NULL,                  -- snapshot ข้อมูลผู้ออกเอกสาร
  bill_to        jsonb NOT NULL,                  -- snapshot ข้อมูลผู้จ่าย
  lines          jsonb NOT NULL,                  -- snapshot รายการ
  total          bigint NOT NULL,
  pdf_file_id    uuid,
  status         text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','VOID')),
  void_reason    text,
  issued_by      uuid REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_sequences (         -- เลขที่ต่อเนื่องแยกตามที่พัก
  property_id uuid REFERENCES properties(id),
  prefix      text,          -- BK, INV, RC
  year        int,
  last_no     int NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, prefix, year)
);

-- ===== ระบบ =====
CREATE TABLE files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket      text NOT NULL,
  path        text NOT NULL,
  mime_type   text NOT NULL,
  size_bytes  bigint NOT NULL,
  uploaded_by uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (               -- กระดิ่งในแอป
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES profiles(id),  -- NULL = ทุกคน
  type       text NOT NULL,
  title      text NOT NULL,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE line_message_log (            -- นับโควตา push
  id         bigserial PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('PUSH','REPLY')),
  recipients int  NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  ok         boolean NOT NULL
);

CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  actor_id   uuid,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  uuid NOT NULL,
  before     jsonb,
  after      jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**หมายเหตุ**
- เลขที่เอกสารออกด้วย `UPDATE document_sequences SET last_no = last_no + 1 WHERE ... RETURNING last_no` ใน transaction เดียวกับการสร้างเอกสาร → ไม่ซ้ำ ไม่ข้าม
- `charge_periods.total_amount / paid_amount / status` อัปเดตด้วย trigger + job รายวัน → query สถานะเร็ว ไม่ต้อง sum ทุกครั้ง
- RLS ตัวอย่าง: `FRONT_DESK` อ่าน/เขียน bookings, payments ได้ แต่ void เอกสารไม่ได้ · `ACCOUNTANT` เขียน documents/refunds ได้
- **RLS รายที่พัก:** ทุกตารางที่ผูกกับที่พักตรวจ `app.can_access_property(property_id)` = ADMIN หรือมีแถวใน `property_staff`
- ห้อง/ราคา/ค่าบริการ/อัตราค่าน้ำไฟ/มิเตอร์ ผูกกับที่พักทั้งหมด → เพิ่มที่พักใหม่ไม่กระทบที่พักเดิม

---

## 12. Server Functions (Server Actions / Route Handlers)

UI ใช้งานภายในบริษัทเท่านั้น → การเขียนข้อมูลใช้ **Server Actions** · Route Handlers ใช้กับ cron, LINE webhook, ดาวน์โหลด PDF/CSV · ทุก action: ตรวจ session + role → validate ด้วย Zod → เรียก service → audit log

| กลุ่ม | ฟังก์ชัน |
|---|---|
| Inventory | `createProperty`, `updateProperty`, `activateProperty` (ตรวจว่าตั้งค่าครบ), `archiveProperty`, `assignPropertyStaff`, `createRoomType`, `createUnit`, `bulkCreateUnits({prefix, from, to, floor})`, `updateUnit`, `createBlock`, `removeBlock` |
| Pricing | `upsertRatePlan`, `upsertRateOverride`, `upsertFee`, `upsertUtilityRate`, `upsertChargeType`, `getQuote(input)` |
| Availability | `searchAvailability({from,to,mode,guests,roomTypeId})`, `getCalendar({propertyId,from,to})`, `getUpcomingVacancies(days)` |
| Booking | `createBooking`, `confirmBooking`, `updateBooking(version)`, `extendBooking`, `cancelBooking`, `checkIn`, `checkOut`, `markNoShow` |
| Lease | `createLease`, `generateLeasePdf`, `attachSignedLease`, `giveNotice`, `renewLease`, `terminateLease` |
| Periods & Payments | `getPeriods(bookingId)`, `getPaymentBoard({propertyId, month})`, `recordPayment`, `voidPayment`, `waivePeriod`, `addAdjustment`, `recordRefund` |
| Meters | `getMeterSheet({propertyId,date})`, `saveMeterReadings(bulk)`, `billUtilities({propertyId,date})` |
| Deposits | `settleDeposit({deductions[]})` |
| Documents | `issueInvoice`, `issueReceipt(paymentId)`, `voidDocument`, `getDocumentForPrint`, `attachDocumentPdf` |
| Reports | `occupancyReport`, `revenueReport`, `arAgingReport`, `depositReport`, `propertyComparison`, `exportCsv` (ทุกรายงานรับ `propertyId` หรือ `all`) |
| System | `/api/cron/daily-digest`, `/api/line/webhook`, `addTeamMember(email, role, propertyIds)`, `updateTeamMember`, `deactivateTeamMember` (ตัด session) |

**รหัส error สำคัญ:** `BOOKING_CONFLICT` (ห้องไม่ว่าง — จาก exclusion constraint `23P01`), `VERSION_CONFLICT`, `HOLD_EXPIRED`, `RULE_VIOLATION`, `PERIOD_ALREADY_PAID`, `DOCUMENT_LOCKED`

---

## 13. โครงสร้างโค้ด

```
/app/(app)/...              หน้าจอ (ทำหลัง approve)
/app/api/cron/*             งานตามเวลา (ป้องกันด้วย CRON_SECRET)
/app/api/line/webhook       รับข้อความจาก LINE (ตรวจ signature)
/src/domain/                กฎธุรกิจล้วน (ไม่มี I/O) → unit test
    pricing/{daily,yearly,quote}.ts
    periods.ts  utilities.ts  cancellation.ts
    booking-state.ts  lease-state.ts  period-status.ts
/src/server/actions/        Server Actions
/src/server/services/       transaction + repository + audit
/src/db/schema.ts           Drizzle schema
/supabase/migrations/       SQL migrations (constraints, RLS, pg_cron)
/src/lib/                   money, dates (Asia/Bangkok), supabase clients, db (Hyperdrive), line
/workers/cron/              Cloudflare Worker สำหรับ Cron Triggers
/wrangler.jsonc             config ของ Cloudflare (Hyperdrive binding, nodejs_compat)
/tests/                     Vitest (domain) + integration (Supabase local)
```

**Library:** `@opennextjs/cloudflare` · `@supabase/ssr` · Drizzle ORM + `postgres` · Zod · date-fns + `@date-fns/tz` · `@react-pdf/renderer` (ฝั่ง browser) · Vitest · LINE เรียก Messaging API ด้วย `fetch` โดยตรง (เบาและเข้ากับ Workers)

---

## 14. แผนการพัฒนา

| เฟส | ขอบเขต |
|---|---|
| **MVP** | M1–M10 (P1), M11-01/02/03, M12 (P1), M13 |
| **เฟส 2** | VAT + Tax Invoice + Credit Note, iCal sync, ส่วนลดตามระยะพัก, ต่อสัญญาอัตโนมัติ, คัดลอกการตั้งค่าที่พัก, แจ้งเตือนผู้เช่าทาง LINE, housekeeping/แจ้งซ่อม, blacklist, ตม.30, ADR/RevPAR |

---

## 15. สถานะ

เอกสารนี้ **Approved** แล้ว · ขั้นต่อไป: ออกแบบหน้าจอ (`docs/02-screen-design.md`)
