# Pre-Booking — Functional Design (v0.1, รอ approve)

ระบบให้ **Host** จัดการห้องพักและการจอง รองรับการเช่า 3 โหมด: **รายวัน (Daily)**, **รายเดือน (Monthly)**, **รายปี (Yearly)**

- FE: Next.js + TypeScript + React
- BE: Next.js (Route Handlers / Server Actions) บน Node.js
- DB: PostgreSQL

> เอกสารนี้เป็นการออกแบบ **ฟังก์ชัน ข้อมูล และกฎทางธุรกิจ** เท่านั้น หน้าจอ (UI) จะออกแบบหลังจากเอกสารนี้ได้รับการ approve

---

## 1. Best Practices ที่นำมาใช้

สรุปจากแนวทางที่ระบบจัดการที่พัก (PMS) อย่าง Cloudbeds, Guesty, Hostaway, ระบบ OTA อย่าง Airbnb/Booking.com และระบบจัดการหอพัก/อพาร์ตเมนต์ในไทยใช้กัน

| # | Best Practice | นำมาใช้อย่างไรในระบบนี้ |
|---|---|---|
| 1 | **แยก "การจองระยะสั้น" กับ "สัญญาเช่าระยะยาว"** | รายวัน = `Booking` (จ่ายครั้งเดียว), รายเดือน/รายปี = `Booking` + `Lease` (สัญญา) + ตารางบิลรายงวด |
| 2 | **ช่วงวันที่แบบ half-open `[check_in, check_out)`** | วัน check-out ของคนหนึ่งเป็นวัน check-in ของอีกคนได้ ไม่ชนกัน |
| 3 | **กันจองซ้อนที่ระดับ Database** ไม่ใช่แค่ใน code | ใช้ PostgreSQL `EXCLUDE USING gist` บน `daterange` → ป้องกัน race condition 100% |
| 4 | **Hold / Tentative booking มีวันหมดอายุ** | ล็อกห้องชั่วคราว (เช่น 15 นาที หรือ 24 ชม. รอมัดจำ) แล้วปล่อยอัตโนมัติ |
| 5 | **Booking state machine ที่ชัดเจน** | เปลี่ยนสถานะได้เฉพาะเส้นทางที่กำหนด + เก็บประวัติทุกครั้ง |
| 6 | **Price snapshot** | ราคาที่คำนวณตอนจองถูก "แช่แข็ง" ไว้ใน booking; แก้ rate ภายหลังไม่กระทบการจองเดิม |
| 7 | **เงินเก็บเป็นจำนวนเต็ม (สตางค์)** | `BIGINT` หน่วยสตางค์ ห้ามใช้ float |
| 8 | **Timezone ชัดเจน** | วันที่เข้าพักเก็บเป็น `DATE` (เวลาท้องถิ่นของที่พัก), timestamp เก็บ `TIMESTAMPTZ` ค่าเริ่มต้น `Asia/Bangkok` |
| 9 | **Idempotency key** สำหรับการสร้างการจอง/ชำระเงิน | กดซ้ำหรือ network retry ไม่สร้างรายการซ้ำ |
| 10 | **Ledger แบบ append-only** สำหรับการเงิน | ไม่ลบ/แก้ยอด ใช้รายการปรับปรุง (adjustment/refund) แทน |
| 11 | **Security deposit แยกจากรายได้** | เงินประกันเป็นหนี้สินที่ต้องคืน มีรายการหักค่าเสียหายพร้อมหลักฐาน |
| 12 | **Proration (คิดตามสัดส่วน)** สำหรับเดือนแรก/เดือนสุดท้าย | เลือกได้: คิดตามวันจริง หรือ รอบบิลตามวันเข้าพัก (anniversary billing) |
| 13 | **มิเตอร์น้ำ/ไฟ** (ระยะยาวในไทย) | จดเลขมิเตอร์รายเดือน คิดตามหน่วย × เรท + ขั้นต่ำ |
| 14 | **Audit log** | ทุกการแก้ไขการจอง/ราคา/การเงิน บันทึกว่าใคร ทำอะไร เมื่อไร |
| 15 | **Calendar sync (iCal)** | export/import iCal กับ Airbnb/Booking.com เพื่อกันจองซ้อนข้ามช่องทาง (เฟส 2) |
| 16 | **PDPA** | เก็บข้อมูลบัตรประชาชน/พาสปอร์ตเท่าที่จำเป็น, จำกัดสิทธิ์การเข้าถึง, กำหนดระยะเวลาเก็บ |

---

## 2. แนวคิดหลัก (Domain Model)

```
Host (Organization)
 └── Property (อาคาร/โครงการ)
      ├── RoomType (ประเภทห้อง: Studio, 1BR ...)
      │    └── RatePlan (แผนราคา ตามโหมด DAILY / MONTHLY / YEARLY)
      └── Unit (ห้องจริง: 101, 102 ...)
           └── Booking ──(ถ้าเป็น MONTHLY/YEARLY)──> Lease (สัญญา)
                 │                                     └── BillingSchedule → Invoice → Payment
                 ├── Guest / Tenant
                 ├── Deposit
                 └── MeterReading (น้ำ/ไฟ)
```

### 2.1 โหมดการเช่า (Rental Mode)

| หัวข้อ | รายวัน (DAILY) | รายเดือน (MONTHLY) | รายปี (YEARLY) |
|---|---|---|---|
| หน่วยราคา | ต่อคืน | ต่อเดือน | ต่อปี (หรือต่อเดือนแบบสัญญา 12 เดือน) |
| ระยะขั้นต่ำ | min nights (เช่น 1) | min months (เช่น 1 หรือ 3) | 12 เดือน |
| เอกสาร | Booking confirmation | สัญญาเช่า (Lease) | สัญญาเช่า (Lease) |
| การชำระเงิน | ครั้งเดียว (หรือมัดจำ + ส่วนที่เหลือ) | ล่วงหน้า + มัดจำ + บิลรายเดือน | ตามตารางงวด (รายเดือน / ราย 6 เดือน / ทั้งปี) |
| เงินประกัน | ไม่บังคับ | ปกติ 1–2 เดือน | ปกติ 1–3 เดือน |
| ค่าน้ำ/ไฟ | รวมในราคา | แยกตามมิเตอร์ (ตั้งค่าได้) | แยกตามมิเตอร์ (ตั้งค่าได้) |
| ค่าทำความสะอาด | ต่อการจอง | ตอนย้ายออก (ตั้งค่าได้) | ตอนย้ายออก |
| ต่ออายุ | ขยายวัน (extend) | ต่อสัญญา / month-to-month | ต่อสัญญา |
| ยกเลิก | ตาม cancellation policy | แจ้งล่วงหน้า N วัน + เงื่อนไขริบมัดจำ | แจ้งล่วงหน้า + ค่าปรับผิดสัญญา |

> **หลักสำคัญ:** ทุกโหมดใช้ตาราง `bookings` และกลไกกันจองซ้อนเดียวกัน ความต่างอยู่ที่ **การคิดราคา** และ **การออกบิล** ทำให้ปฏิทินห้องว่างเห็นทุกโหมดในที่เดียว

### 2.2 ห้องเดียวรองรับหลายโหมด

Unit หนึ่งห้องสามารถเปิดได้หลายโหมดพร้อมกัน (เช่น ห้องว่างช่วงสั้นๆ ระหว่างผู้เช่ารายเดือน เปิดขายรายวันได้) โดยกำหนดที่ `units.allowed_modes`

---

## 3. รายการฟังก์ชัน (Function List)

รหัสฟังก์ชันใช้อ้างอิงตอนออกแบบหน้าจอและ API ต่อไป · **P** = Priority (1 = MVP, 2 = เฟสถัดไป)

### M1 — บัญชีและสิทธิ์ (Auth & Team)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M1-01 | สมัคร / เข้าสู่ระบบ Host | Email + password, Google login (ตัวเลือก) | 1 |
| M1-02 | จัดการทีมงาน | เชิญ staff, กำหนด role | 1 |
| M1-03 | Role & Permission | `OWNER`, `MANAGER`, `FRONT_DESK`, `ACCOUNTANT`, `HOUSEKEEPING` | 1 |
| M1-04 | ตั้งค่าองค์กร | ชื่อ, เลขผู้เสียภาษี, ที่อยู่ออกใบเสร็จ, โลโก้, สกุลเงิน, timezone | 1 |

### M2 — ทรัพย์สินและห้อง (Property & Inventory)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M2-01 | CRUD Property | ชื่อ, ที่อยู่, เวลา check-in/out เริ่มต้น, นโยบาย | 1 |
| M2-02 | CRUD RoomType | ชื่อ, ขนาด, จำนวนผู้เข้าพักสูงสุด, สิ่งอำนวยความสะดวก, รูปภาพ | 1 |
| M2-03 | CRUD Unit | เลขห้อง, ชั้น, โหมดที่เปิด (`allowed_modes`), สถานะ (ACTIVE / MAINTENANCE / INACTIVE) | 1 |
| M2-04 | ปิดห้องชั่วคราว (Block) | ปิดช่วงวันที่เพื่อซ่อม/ใช้เอง — ใช้กลไกเดียวกับการจองเพื่อกันชน | 1 |
| M2-05 | มิเตอร์ประจำห้อง | ตั้งค่ามิเตอร์น้ำ/ไฟ, เลขเริ่มต้น | 1 |

### M3 — ราคา (Pricing & Rate Plans)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M3-01 | Rate Plan รายวัน | ราคาฐานต่อคืน, ราคาวันหยุดสุดสัปดาห์, min/max nights | 1 |
| M3-02 | ราคาตามช่วงเวลา (Seasonal / Date override) | ช่วง high season, เทศกาล, ราคาเฉพาะวัน (priority สูงกว่าราคาฐาน) | 1 |
| M3-03 | ส่วนลดตามระยะพัก (LOS discount) | เช่น พัก ≥7 คืน ลด 10%, ≥28 คืน ลด 20% | 2 |
| M3-04 | Rate Plan รายเดือน | ค่าเช่า/เดือน, ระยะขั้นต่ำ, เงินประกัน (จำนวนเดือน), จ่ายล่วงหน้า (จำนวนเดือน) | 1 |
| M3-05 | Rate Plan รายปี | ค่าเช่า/ปี หรือ/เดือน, ส่วนลดเทียบรายเดือน, รูปแบบงวดชำระ | 1 |
| M3-06 | ค่าบริการเพิ่ม (Fees & Add-ons) | ค่าทำความสะอาด, ผู้เข้าพักเพิ่ม, ที่จอดรถ, อินเทอร์เน็ต, เฟอร์นิเจอร์ — กำหนดเป็น ต่อการจอง / ต่อคืน / ต่อเดือน | 1 |
| M3-07 | อัตราค่าน้ำ/ไฟ | บาท/หน่วย, ค่าขั้นต่ำ, หรือเหมาจ่าย | 1 |
| M3-08 | ภาษี/ค่าบริการ | VAT 7% (รวม/ไม่รวมในราคา), service charge | 1 |
| M3-09 | **Quote Engine** | คำนวณราคาจาก (unit, mode, วันที่, จำนวนคน, add-ons) → แสดงรายละเอียดแยกรายการ | 1 |

### M4 — ปฏิทินและห้องว่าง (Availability & Calendar)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M4-01 | ค้นหาห้องว่าง | ตามช่วงวันที่, โหมด, จำนวนคน, ประเภทห้อง | 1 |
| M4-02 | ปฏิทินรวม (Timeline / Tape chart) | แกน Y = ห้อง, แกน X = วัน แสดงการจองทุกโหมด + block | 1 |
| M4-03 | Occupancy forecast | ห้องที่จะว่างใน 30/60/90 วัน (สัญญาใกล้หมด) | 2 |
| M4-04 | iCal export/import | sync กับ Airbnb / Booking.com | 2 |

### M5 — การจอง (Booking) — ใช้ร่วมทุกโหมด

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M5-01 | สร้างการจอง (manual โดย Host) | เลือกห้อง โหมด วันที่ ผู้เข้าพัก → ได้ quote → ยืนยัน | 1 |
| M5-02 | Hold ห้องชั่วคราว | สถานะ `HOLD` มี `hold_expires_at`; หมดเวลาปล่อยอัตโนมัติ | 1 |
| M5-03 | ยืนยันการจอง | เมื่อได้รับมัดจำ/ชำระครบ → `CONFIRMED` | 1 |
| M5-04 | แก้ไขการจอง | เปลี่ยนวันที่/ย้ายห้อง (ตรวจห้องว่างใหม่ + re-quote + เก็บส่วนต่าง) | 1 |
| M5-05 | ขยายเวลาเข้าพัก (Extend) | รายวัน: เพิ่มคืน · รายเดือน: เพิ่มเดือน | 1 |
| M5-06 | ยกเลิกการจอง | คำนวณค่าปรับ/ยอดคืนตาม cancellation policy | 1 |
| M5-07 | Check-in | บันทึกเวลาเข้าจริง, ตรวจเอกสาร, จดมิเตอร์เริ่มต้น (ระยะยาว) | 1 |
| M5-08 | Check-out | บันทึกเวลาออก, จดมิเตอร์สุดท้าย, ตรวจห้อง, ปิดบิล | 1 |
| M5-09 | No-show | รายวัน: ไม่มาเช็กอินภายในเวลาที่กำหนด → `NO_SHOW` + ริบมัดจำตามนโยบาย | 1 |
| M5-10 | หน้าจองออนไลน์สำหรับลูกค้า (Booking engine) | ลิงก์สาธารณะให้ลูกค้าจองเอง | 2 |
| M5-11 | Cancellation Policy | Flexible / Moderate / Strict / กำหนดเอง (เป็นขั้นตามจำนวนวันก่อนเข้าพัก) | 1 |

### M6 — สัญญาเช่า (Lease) — เฉพาะรายเดือน/รายปี

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M6-01 | สร้างสัญญาจากการจอง | ดึงข้อมูลผู้เช่า, ห้อง, ค่าเช่า, ระยะเวลา, เงินประกัน, เงื่อนไข | 1 |
| M6-02 | เทมเพลตสัญญา | Host ตั้งค่า template (ตัวแปร เช่น `{{tenant_name}}`) → generate PDF | 1 |
| M6-03 | ลงนามสัญญา | อัปโหลดสัญญาที่เซ็นแล้ว (P1) / e-signature (P2) | 1 |
| M6-04 | ตารางชำระเงิน (Billing Schedule) | สร้างงวดอัตโนมัติตามรอบบิลและ proration | 1 |
| M6-05 | ต่อสัญญา (Renewal) | แจ้งเตือนก่อนหมด N วัน, สร้างสัญญาใหม่ (ปรับราคาได้) เชื่อมกับสัญญาเดิม | 1 |
| M6-06 | แจ้งย้ายออก (Notice to vacate) | บันทึกวันแจ้ง, ตรวจระยะแจ้งล่วงหน้า, คำนวณค่าปรับถ้าแจ้งไม่ครบ | 1 |
| M6-07 | ยกเลิกสัญญาก่อนกำหนด | คำนวณค่าปรับ/ริบเงินประกันตามสัญญา | 1 |
| M6-08 | Month-to-month | หลังสัญญาหมด ต่ออายุอัตโนมัติรายเดือน (ตั้งค่าได้) | 2 |

### M7 — บิลและการเงิน (Billing & Payments)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M7-01 | ออกใบแจ้งหนี้ (Invoice) | อัตโนมัติจาก billing schedule + manual | 1 |
| M7-02 | จดมิเตอร์น้ำ/ไฟ | จดรายห้อง/ทั้งตึก (bulk), แนบรูป, ตรวจค่าผิดปกติ (เลขลดลง / ใช้เกินค่าเฉลี่ยมาก) | 1 |
| M7-03 | รวมค่าน้ำ/ไฟเข้าบิล | หน่วยที่ใช้ × เรท (ขั้นต่ำ) → invoice line | 1 |
| M7-04 | บันทึกการชำระเงิน | เงินสด, โอน (แนบสลิป), PromptPay QR; รองรับจ่ายบางส่วน | 1 |
| M7-05 | PromptPay QR / Payment gateway | สร้าง QR ตามยอด, ตรวจสลิปอัตโนมัติ (P2), gateway เช่น Omise/2C2P (P2) | 2 |
| M7-06 | ค่าปรับชำระล่าช้า (Late fee) | เกิน grace period → คิดค่าปรับ (เหมา/ต่อวัน) | 1 |
| M7-07 | เงินประกัน (Deposit) | รับ, ถือ, หักค่าเสียหาย (พร้อมรูป/รายการ), คืน | 1 |
| M7-08 | ใบเสร็จ / ใบกำกับภาษี | เลขที่เอกสารต่อเนื่องตามปี, PDF | 1 |
| M7-09 | Credit note / Refund | คืนเงินจากการยกเลิก/ลดราคา ผ่านรายการปรับปรุง | 1 |
| M7-10 | ยอดค้างชำระ (AR aging) | ค้าง 0–30 / 31–60 / 60+ วัน | 1 |

### M8 — ผู้เข้าพัก/ผู้เช่า (Guest & Tenant)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M8-01 | ข้อมูลผู้เข้าพัก | ชื่อ, เบอร์, email, LINE ID, สัญชาติ | 1 |
| M8-02 | เอกสารยืนยันตัวตน | บัตรประชาชน/พาสปอร์ต (จำกัดสิทธิ์การดู, เข้ารหัสไฟล์) | 1 |
| M8-03 | ผู้พักร่วม | รายชื่อผู้พักอาศัยร่วมในห้อง | 1 |
| M8-04 | ประวัติ & Blacklist | ประวัติการเข้าพัก, หมายเหตุ, ติดธงห้ามรับ | 2 |
| M8-05 | รายงาน ตม.30 | export ข้อมูลชาวต่างชาติสำหรับแจ้งที่พัก | 2 |

### M9 — งานปฏิบัติการ (Operations)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M9-01 | Dashboard วันนี้ | เข้า/ออกวันนี้, ห้องว่าง, บิลค้าง, สัญญาใกล้หมด | 1 |
| M9-02 | Housekeeping | สถานะห้อง (DIRTY / CLEAN / INSPECTED), งานทำความสะอาดอัตโนมัติหลัง check-out | 2 |
| M9-03 | แจ้งซ่อม (Maintenance) | ผู้เช่าแจ้ง / host สร้าง, ติดตามสถานะ, ปิดห้องได้ | 2 |

### M10 — แจ้งเตือน (Notifications)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M10-01 | แจ้งเตือนผู้เข้าพัก | ยืนยันการจอง, ก่อนเข้าพัก, บิลออก, ใกล้ครบกำหนด, เกินกำหนด | 1 (Email) / 2 (LINE OA, SMS) |
| M10-02 | แจ้งเตือน Host | การจองใหม่, hold ใกล้หมด, สัญญาใกล้หมด, ยอดค้าง | 1 |
| M10-03 | เทมเพลตข้อความ | Host แก้ข้อความได้ | 2 |

### M11 — รายงาน (Reports)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M11-01 | Occupancy rate | แยกตามโหมด/ประเภทห้อง/ช่วงเวลา | 1 |
| M11-02 | รายได้ | แยกค่าเช่า, ค่าน้ำไฟ, ค่าบริการ; แยกโหมด | 1 |
| M11-03 | ADR / RevPAR | สำหรับรายวัน | 2 |
| M11-04 | ยอดค้างชำระ & เงินประกันคงค้าง | | 1 |
| M11-05 | Export CSV/Excel | | 1 |

### M12 — ระบบ (Platform)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M12-01 | Audit log | ทุก action สำคัญ (before/after) | 1 |
| M12-02 | Background jobs | ดูหัวข้อ 7 | 1 |
| M12-03 | File storage | สลิป, สัญญา, เอกสาร (S3-compatible) | 1 |

---

## 4. Booking State Machine

```
               ┌──────────── expire ───────────┐
               │                               ▼
  (create) → HOLD ── confirm ──> CONFIRMED   EXPIRED
               │                    │  │
               └── cancel ─┐        │  └── cancel ──> CANCELLED
                           ▼        │
                       CANCELLED    ├── no-show ───> NO_SHOW   (เฉพาะรายวัน)
                                    │
                                 check-in
                                    ▼
                               CHECKED_IN ── check-out ──> CHECKED_OUT ── settle ──> CLOSED
                                    │
                                    └── early termination ──> CHECKED_OUT (+ ค่าปรับ)
```

- **สถานะที่ "ครองห้อง"** (นับในการกันจองซ้อน): `HOLD`, `CONFIRMED`, `CHECKED_IN`
- สถานะอื่นไม่ครองห้อง → ห้องกลับมาว่าง
- `CLOSED` = เคลียร์ยอดเงินและเงินประกันครบแล้ว
- ทุกการเปลี่ยนสถานะบันทึกลง `booking_status_history`

### Lease State

`DRAFT → PENDING_SIGNATURE → ACTIVE → (NOTICE_GIVEN) → ENDED` · หรือ `ACTIVE → TERMINATED` · หรือ `ACTIVE → RENEWED` (เชื่อมไปสัญญาใหม่)

### Invoice State

`DRAFT → ISSUED → PARTIALLY_PAID → PAID` · หรือ `ISSUED → OVERDUE` · หรือ `VOID`

---

## 5. กฎทางธุรกิจที่สำคัญ (Business Rules)

### 5.1 การคำนวณราคา — รายวัน

```
for each night in [check_in, check_out):
    price = date_override ?? seasonal_rate ?? (isWeekend ? weekend_rate : base_rate)
subtotal  = Σ price
discount  = LOS discount (ถ้ามี — เลือกขั้นที่ดีที่สุด ไม่ซ้อนกัน)
fees      = cleaning fee + extra guest fee × nights + add-ons
tax       = VAT (ถ้าราคาไม่รวม VAT)
total     = subtotal − discount + fees + tax
```

- ตรวจ `min_nights`, `max_nights`, `max_occupancy`
- ถ้าพักนาน ≥ เกณฑ์ (เช่น 28 คืน) ระบบ **แนะนำ** ให้เปลี่ยนเป็นโหมดรายเดือน

### 5.2 การคำนวณราคา — รายเดือน

- **วันเริ่มสัญญา** เลือกได้ทุกวัน
- **รอบบิล** (ตั้งค่าระดับ Property):
  - `ANNIVERSARY` — บิลทุกวันที่เท่ากับวันเข้า (เข้า 15 → บิลทุกวันที่ 15) ไม่ต้อง prorate
  - `CALENDAR_MONTH` — บิลทุกวันที่ 1, เดือนแรก prorate = `ค่าเช่า × วันที่พักจริง / จำนวนวันในเดือนนั้น`
- **ตอนทำสัญญาเก็บ:** เงินประกัน (N เดือน) + ค่าเช่าล่วงหน้า (M เดือน) + ค่าบริการแรกเข้า
- **บิลรายเดือน** = ค่าเช่า + ค่าน้ำ + ค่าไฟ + ค่าบริการรายเดือน − ส่วนลด
- **วันที่ 31 / ก.พ.:** ถ้ารอบบิลคือวันที่ 29–31 แต่เดือนนั้นไม่มีวันดังกล่าว → ใช้วันสุดท้ายของเดือน

### 5.3 การคำนวณราคา — รายปี

- ระยะสัญญา 12 เดือน (หรือหลายปี)
- ราคา: กำหนดเป็นต่อปี หรือ ส่วนลด % จากราคารายเดือน
- รูปแบบงวด: `MONTHLY` (12 งวด), `QUARTERLY`, `SEMI_ANNUAL`, `ANNUAL` (จ่ายครั้งเดียว อาจได้ส่วนลดเพิ่ม)
- ค่าน้ำ/ไฟ ยังออกบิลรายเดือนแยกจากงวดค่าเช่า
- ยกเลิกก่อนกำหนด: ค่าปรับตามสัญญา (เช่น ริบเงินประกัน หรือ ค่าเช่า X เดือน)

### 5.4 การกันจองซ้อน

1. ตรวจซ้ำในระดับแอป (ให้ error ที่อ่านง่าย)
2. **บังคับในระดับ DB** ด้วย exclusion constraint (ดูหัวข้อ 6) → ถ้า 2 request พร้อมกัน จะสำเร็จแค่ 1 อีกอันได้ error `23P01` → API ตอบ `409 Conflict`
3. Block ห้อง (ซ่อม/ใช้เอง) ใช้ตารางเดียวกันกับ `kind = 'BLOCK'` จึงชนกันได้โดยอัตโนมัติ
4. Buffer วันทำความสะอาด (ตั้งค่าได้ เช่น 0–1 วัน หลังการเช่าระยะยาว)

### 5.5 Cancellation Policy (รายวัน) — ตัวอย่าง

| Policy | ยกเลิก ≥ X วันก่อนเข้า | คืนเงิน |
|---|---|---|
| Flexible | ≥ 1 วัน | 100% |
| Moderate | ≥ 5 วัน / < 5 วัน | 100% / 50% |
| Strict | ≥ 14 วัน / 7–13 วัน / < 7 วัน | 100% / 50% / 0% |

เก็บเป็นตาราง rules (`days_before`, `refund_percent`) → Host สร้างแบบกำหนดเองได้ และ snapshot policy ลงใน booking ตอนจอง

### 5.6 เงินประกัน

- สถานะ: `PENDING → HELD → PARTIALLY_REFUNDED / REFUNDED / FORFEITED`
- ตอนย้ายออก: สร้าง **Deposit settlement** = เงินประกัน − ค่าเสียหาย − ค่าน้ำไฟเดือนสุดท้าย − ยอดค้าง → คืน (หรือออกบิลเพิ่มถ้าติดลบ)
- กำหนดระยะเวลาคืน (เช่น ภายใน 30 วันหลังย้ายออก) และแจ้งเตือน Host

---

## 6. Database Schema (PostgreSQL — ร่าง)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE rental_mode     AS ENUM ('DAILY','MONTHLY','YEARLY');
CREATE TYPE booking_status  AS ENUM ('HOLD','CONFIRMED','CHECKED_IN','CHECKED_OUT','CLOSED',
                                     'CANCELLED','NO_SHOW','EXPIRED');
CREATE TYPE booking_kind    AS ENUM ('RESERVATION','BLOCK');
CREATE TYPE billing_cycle   AS ENUM ('ANNIVERSARY','CALENDAR_MONTH');
CREATE TYPE pay_frequency   AS ENUM ('MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','ONE_TIME');
CREATE TYPE lease_status    AS ENUM ('DRAFT','PENDING_SIGNATURE','ACTIVE','NOTICE_GIVEN',
                                     'ENDED','TERMINATED','RENEWED');
CREATE TYPE invoice_status  AS ENUM ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','OVERDUE','VOID');

-- ===== Tenancy / Auth =====
CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  tax_id        text,
  currency      char(3) NOT NULL DEFAULT 'THB',
  timezone      text    NOT NULL DEFAULT 'Asia/Bangkok',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  password_hash text,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id   uuid REFERENCES organizations(id),
  user_id  uuid REFERENCES users(id),
  role     text NOT NULL CHECK (role IN ('OWNER','MANAGER','FRONT_DESK','ACCOUNTANT','HOUSEKEEPING')),
  PRIMARY KEY (org_id, user_id)
);

-- ===== Inventory =====
CREATE TABLE properties (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id),
  name               text NOT NULL,
  address            jsonb,
  check_in_time      time NOT NULL DEFAULT '14:00',
  check_out_time     time NOT NULL DEFAULT '12:00',
  billing_cycle      billing_cycle NOT NULL DEFAULT 'ANNIVERSARY',
  invoice_due_days   int  NOT NULL DEFAULT 5,
  late_fee_rule      jsonb,             -- {type:'PER_DAY'|'FLAT', amount, grace_days}
  turnover_buffer_days int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE room_types (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES properties(id),
  name           text NOT NULL,
  max_occupancy  int  NOT NULL,
  size_sqm       numeric(6,2),
  amenities      text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE units (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES properties(id),
  room_type_id   uuid NOT NULL REFERENCES room_types(id),
  code           text NOT NULL,                 -- เลขห้อง
  floor          text,
  allowed_modes  rental_mode[] NOT NULL DEFAULT '{DAILY}',
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MAINTENANCE','INACTIVE')),
  UNIQUE (property_id, code)
);

-- ===== Pricing =====
CREATE TABLE rate_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id        uuid NOT NULL REFERENCES room_types(id),
  mode                rental_mode NOT NULL,
  name                text NOT NULL,
  base_amount         bigint NOT NULL,     -- สตางค์: ต่อคืน / ต่อเดือน / ต่อปี ตาม mode
  weekend_amount      bigint,              -- DAILY เท่านั้น
  min_length          int NOT NULL DEFAULT 1, -- คืน หรือ เดือน
  max_length          int,
  deposit_months      numeric(4,2),        -- MONTHLY/YEARLY
  advance_months      int,                 -- MONTHLY/YEARLY
  pay_frequency       pay_frequency,       -- YEARLY
  vat_inclusive       boolean NOT NULL DEFAULT true,
  cancellation_policy_id uuid,
  is_active           boolean NOT NULL DEFAULT true
);

CREATE TABLE rate_overrides (               -- seasonal / วันพิเศษ (DAILY)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_plan_id  uuid NOT NULL REFERENCES rate_plans(id),
  during        daterange NOT NULL,
  amount        bigint NOT NULL,
  priority      int NOT NULL DEFAULT 0,
  min_length    int
);

CREATE TABLE los_discounts (
  rate_plan_id  uuid REFERENCES rate_plans(id),
  min_nights    int NOT NULL,
  percent       numeric(5,2) NOT NULL,
  PRIMARY KEY (rate_plan_id, min_nights)
);

CREATE TABLE fees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES properties(id),
  name         text NOT NULL,
  amount       bigint NOT NULL,
  charge_basis text NOT NULL CHECK (charge_basis IN ('PER_BOOKING','PER_NIGHT','PER_MONTH','PER_GUEST_NIGHT','ON_MOVE_OUT')),
  applies_to   rental_mode[] NOT NULL,
  is_optional  boolean NOT NULL DEFAULT false
);

CREATE TABLE utility_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES properties(id),
  utility       text NOT NULL CHECK (utility IN ('WATER','ELECTRIC')),
  price_per_unit bigint NOT NULL,
  minimum_charge bigint NOT NULL DEFAULT 0,
  flat_rate     bigint,                       -- ถ้าเหมาจ่าย
  effective_from date NOT NULL
);

CREATE TABLE cancellation_policies (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id   uuid NOT NULL REFERENCES organizations(id),
  name     text NOT NULL,
  rules    jsonb NOT NULL     -- [{days_before:14, refund_percent:100}, ...]
);

-- ===== Guests =====
CREATE TABLE guests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  full_name     text NOT NULL,
  phone         text,
  email         text,
  line_id       text,
  nationality   char(2),
  id_doc_type   text,
  id_doc_number_enc bytea,         -- เข้ารหัส (PDPA)
  notes         text,
  is_blacklisted boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ===== Bookings (หัวใจของระบบ) =====
CREATE TABLE bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id),
  code             text UNIQUE NOT NULL,        -- เช่น BK-2026-000123
  unit_id          uuid NOT NULL REFERENCES units(id),
  kind             booking_kind NOT NULL DEFAULT 'RESERVATION',
  mode             rental_mode,                  -- NULL ได้ถ้าเป็น BLOCK
  status           booking_status NOT NULL,
  stay             daterange NOT NULL,           -- [check_in, check_out)
  guest_id         uuid REFERENCES guests(id),
  adults           int NOT NULL DEFAULT 1,
  children         int NOT NULL DEFAULT 0,
  rate_plan_id     uuid REFERENCES rate_plans(id),
  price_snapshot   jsonb,                        -- quote ที่ยืนยันแล้ว (แยกรายการ)
  policy_snapshot  jsonb,                        -- cancellation policy ตอนจอง
  total_amount     bigint NOT NULL DEFAULT 0,
  hold_expires_at  timestamptz,
  source           text NOT NULL DEFAULT 'DIRECT', -- DIRECT, WALK_IN, AIRBNB, BOOKING_COM, ...
  idempotency_key  text,
  actual_check_in  timestamptz,
  actual_check_out timestamptz,
  version          int NOT NULL DEFAULT 1,       -- optimistic locking
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CHECK (lower(stay) < upper(stay)),
  CHECK (kind = 'BLOCK' OR mode IS NOT NULL),
  UNIQUE (org_id, idempotency_key),

  -- กันจองซ้อน: ห้องเดียวกัน + ช่วงวันซ้อน + สถานะที่ครองห้อง = ห้าม
  CONSTRAINT no_overlap EXCLUDE USING gist (
    unit_id WITH =,
    stay    WITH &&
  ) WHERE (status IN ('HOLD','CONFIRMED','CHECKED_IN'))
);
CREATE INDEX ON bookings (org_id, status);
CREATE INDEX ON bookings USING gist (stay);
CREATE INDEX ON bookings (hold_expires_at) WHERE status = 'HOLD';

CREATE TABLE booking_status_history (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  from_status booking_status,
  to_status   booking_status NOT NULL,
  reason      text,
  changed_by  uuid REFERENCES users(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE booking_occupants (
  booking_id  uuid REFERENCES bookings(id),
  guest_id    uuid REFERENCES guests(id),
  PRIMARY KEY (booking_id, guest_id)
);

-- ===== Leases =====
CREATE TABLE leases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid UNIQUE NOT NULL REFERENCES bookings(id),
  status             lease_status NOT NULL DEFAULT 'DRAFT',
  start_date         date NOT NULL,
  end_date           date NOT NULL,             -- exclusive
  rent_amount        bigint NOT NULL,           -- ต่อเดือน (หรือต่อปีถ้า YEARLY+ANNUAL)
  pay_frequency      pay_frequency NOT NULL,
  billing_cycle      billing_cycle NOT NULL,
  billing_day        int CHECK (billing_day BETWEEN 1 AND 31),
  deposit_amount     bigint NOT NULL DEFAULT 0,
  notice_days        int NOT NULL DEFAULT 30,
  early_termination_rule jsonb,
  auto_renew         boolean NOT NULL DEFAULT false,
  previous_lease_id  uuid REFERENCES leases(id),
  document_file_id   uuid,
  signed_at          timestamptz,
  notice_given_at    date,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing_schedules (             -- งวดที่จะออกบิล
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id      uuid NOT NULL REFERENCES leases(id),
  period        daterange NOT NULL,           -- ช่วงที่งวดนี้ครอบคลุม
  issue_date    date NOT NULL,
  due_date      date NOT NULL,
  rent_amount   bigint NOT NULL,              -- หลัง prorate
  invoice_id    uuid,                         -- เติมเมื่อออกบิลแล้ว
  UNIQUE (lease_id, period)
);

-- ===== Utilities =====
CREATE TABLE meters (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id   uuid NOT NULL REFERENCES units(id),
  utility   text NOT NULL CHECK (utility IN ('WATER','ELECTRIC')),
  serial_no text,
  UNIQUE (unit_id, utility)
);

CREATE TABLE meter_readings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id     uuid NOT NULL REFERENCES meters(id),
  reading_date date NOT NULL,
  value        numeric(12,2) NOT NULL,
  photo_file_id uuid,
  booking_id   uuid REFERENCES bookings(id),
  reading_type text NOT NULL DEFAULT 'MONTHLY' CHECK (reading_type IN ('MOVE_IN','MONTHLY','MOVE_OUT')),
  recorded_by  uuid REFERENCES users(id),
  UNIQUE (meter_id, reading_date, reading_type)
);

-- ===== Billing / Ledger =====
CREATE TABLE invoices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  number       text NOT NULL,                 -- INV-2026-00001 (running ต่อปี)
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  status       invoice_status NOT NULL DEFAULT 'DRAFT',
  issue_date   date,
  due_date     date,
  subtotal     bigint NOT NULL DEFAULT 0,
  vat_amount   bigint NOT NULL DEFAULT 0,
  total        bigint NOT NULL DEFAULT 0,
  paid_amount  bigint NOT NULL DEFAULT 0,
  UNIQUE (org_id, number)
);

CREATE TABLE invoice_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices(id),
  type        text NOT NULL,   -- RENT, NIGHTLY, FEE, WATER, ELECTRIC, LATE_FEE, DEPOSIT, DISCOUNT, ADJUSTMENT
  description text NOT NULL,
  quantity    numeric(12,2) NOT NULL DEFAULT 1,
  unit_price  bigint NOT NULL,
  amount      bigint NOT NULL,
  meta        jsonb            -- เช่น {meter_from, meter_to, period}
);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id),
  booking_id      uuid NOT NULL REFERENCES bookings(id),
  amount          bigint NOT NULL,       -- ติดลบ = refund
  method          text NOT NULL,         -- CASH, TRANSFER, PROMPTPAY, CARD
  reference       text,
  slip_file_id    uuid,
  received_at     timestamptz NOT NULL,
  idempotency_key text,
  recorded_by     uuid REFERENCES users(id),
  UNIQUE (org_id, idempotency_key)
);

CREATE TABLE payment_allocations (      -- จ่าย 1 ครั้ง ตัดได้หลายบิล
  payment_id  uuid REFERENCES payments(id),
  invoice_id  uuid REFERENCES invoices(id),
  amount      bigint NOT NULL,
  PRIMARY KEY (payment_id, invoice_id)
);

CREATE TABLE deposits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  amount       bigint NOT NULL,
  status       text NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING','HELD','PARTIALLY_REFUNDED','REFUNDED','FORFEITED')),
  received_payment_id uuid REFERENCES payments(id)
);

CREATE TABLE deposit_deductions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id  uuid NOT NULL REFERENCES deposits(id),
  reason      text NOT NULL,
  amount      bigint NOT NULL,
  photo_file_ids uuid[] NOT NULL DEFAULT '{}'
);

-- ===== Platform =====
CREATE TABLE files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  storage_key text NOT NULL,
  mime_type   text NOT NULL,
  size_bytes  bigint NOT NULL,
  is_sensitive boolean NOT NULL DEFAULT false,
  uploaded_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL,
  actor_id    uuid,
  action      text NOT NULL,         -- booking.create, invoice.void, ...
  entity      text NOT NULL,
  entity_id   uuid NOT NULL,
  before      jsonb,
  after       jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_sequences (     -- เลขเอกสารต่อเนื่อง ไม่ข้าม
  org_id   uuid,
  doc_type text,        -- BOOKING, INVOICE, RECEIPT, CREDIT_NOTE
  year     int,
  last_no  int NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, doc_type, year)
);
```

**หมายเหตุการออกแบบ DB**
- ทุกตารางมี `org_id` (ตรงหรือผ่าน FK) → รองรับหลาย Host (multi-tenant) และพร้อมใช้ Row-Level Security ภายหลัง
- เลขเอกสารออกด้วย `UPDATE document_sequences SET last_no = last_no + 1 ... RETURNING` ใน transaction เดียวกัน → ไม่ซ้ำ ไม่ข้าม
- ORM แนะนำ: **Drizzle ORM** (รองรับ `daterange`/exclusion constraint ผ่าน raw SQL migration ได้ดี) หรือ Prisma + SQL migration สำหรับส่วนที่ Prisma ไม่รองรับ

---

## 7. Background Jobs

| Job | ความถี่ | หน้าที่ |
|---|---|---|
| `expire-holds` | ทุก 1 นาที | `HOLD` ที่เกิน `hold_expires_at` → `EXPIRED` |
| `mark-no-show` | ทุกวัน (หลังเวลา cut-off) | รายวันที่ไม่ check-in → `NO_SHOW` |
| `generate-invoices` | ทุกวัน 00:05 | `billing_schedules` ที่ถึง `issue_date` → สร้าง invoice (DRAFT รอใส่ค่าน้ำไฟ หรือ ISSUED ทันที ตามการตั้งค่า) |
| `mark-overdue` | ทุกวัน | เกิน `due_date` → `OVERDUE` + คิด late fee |
| `reminders` | ทุกวัน | แจ้งเตือนก่อนครบกำหนดชำระ, ก่อนเข้าพัก, สัญญาใกล้หมด (60/30/7 วัน) |
| `lease-lifecycle` | ทุกวัน | สัญญาถึง `end_date` → ENDED หรือ auto-renew |
| `ical-sync` | ทุก 15 นาที (P2) | ดึงปฏิทินจาก OTA |

**Implementation:** ใช้ **pg-boss** (job queue บน PostgreSQL — ไม่ต้องเพิ่ม Redis) รันใน worker process แยกจาก Next.js · ทุก job ต้อง **idempotent** (รันซ้ำแล้วผลไม่เปลี่ยน)

---

## 8. API Design (Next.js Route Handlers `/api/v1/...`)

ทุก endpoint: ตรวจ session + role, validate ด้วย **Zod**, scope ด้วย `org_id`, error format เดียวกัน `{ error: { code, message, details } }`

### Inventory & Pricing
```
GET|POST         /api/v1/properties
GET|PATCH|DELETE /api/v1/properties/:id
GET|POST         /api/v1/properties/:id/room-types
GET|POST         /api/v1/properties/:id/units
GET|POST         /api/v1/room-types/:id/rate-plans
POST             /api/v1/rate-plans/:id/overrides
GET|POST         /api/v1/properties/:id/fees
GET|POST         /api/v1/properties/:id/utility-rates
```

### Availability & Quote
```
GET  /api/v1/availability?propertyId&from&to&mode&guests        → ห้องว่าง
GET  /api/v1/calendar?propertyId&from&to                        → ข้อมูล tape chart
POST /api/v1/quotes  { unitId, mode, checkIn, checkOut|months, guests, addOns[] }
     → { lines[], subtotal, discount, fees, vat, total, deposit, dueNow, schedulePreview[] }
```

### Bookings
```
POST  /api/v1/bookings                  (Idempotency-Key header)  → HOLD หรือ CONFIRMED
GET   /api/v1/bookings?status&mode&from&to&q
GET   /api/v1/bookings/:id
PATCH /api/v1/bookings/:id              (If-Match: version)      → แก้วันที่/ห้อง/ผู้เข้าพัก
POST  /api/v1/bookings/:id/confirm
POST  /api/v1/bookings/:id/cancel       { reason }  → คืนยอดคืนเงินที่คำนวณได้
POST  /api/v1/bookings/:id/extend       { newCheckOut | addMonths }
POST  /api/v1/bookings/:id/check-in     { meterReadings[] }
POST  /api/v1/bookings/:id/check-out    { meterReadings[], damages[] }
POST  /api/v1/bookings/:id/no-show
POST  /api/v1/blocks                    { unitId, from, to, reason }
```

### Leases
```
POST /api/v1/bookings/:id/lease          → สร้างสัญญา (DRAFT) + billing schedule preview
GET  /api/v1/leases/:id
POST /api/v1/leases/:id/document         → generate PDF
POST /api/v1/leases/:id/sign             { fileId }
POST /api/v1/leases/:id/notice           { noticeDate, moveOutDate }
POST /api/v1/leases/:id/renew            { endDate, rentAmount }
POST /api/v1/leases/:id/terminate        { date, reason }
```

### Billing
```
GET  /api/v1/invoices?status&due&bookingId
POST /api/v1/invoices                    (manual)
POST /api/v1/invoices/:id/issue
POST /api/v1/invoices/:id/void
POST /api/v1/meter-readings/bulk         [{ meterId, date, value, photoId }]
POST /api/v1/payments                    (Idempotency-Key) { bookingId, amount, method, allocations[] }
POST /api/v1/deposits/:id/settle         { deductions[] }
GET  /api/v1/reports/occupancy|revenue|ar-aging|deposits
```

### HTTP status ที่สำคัญ
- `409 BOOKING_CONFLICT` — ห้องไม่ว่าง (จาก exclusion constraint)
- `409 VERSION_CONFLICT` — มีคนแก้การจองนี้ไปก่อน
- `422 RULE_VIOLATION` — ผิดกฎ (min nights, max occupancy, โหมดไม่เปิด ฯลฯ)
- `410 HOLD_EXPIRED`

---

## 9. โครงสร้างโค้ด (เสนอ)

```
/app                      Next.js App Router (หน้าจอ — ทำทีหลัง)
/app/api/v1/...           Route Handlers (บาง: parse → เรียก service → ตอบ)
/src/domain/              กฎทางธุรกิจล้วน ไม่มี I/O → unit test ง่าย
    pricing/daily.ts, monthly.ts, yearly.ts, quote.ts
    proration.ts, cancellation.ts, billing-schedule.ts, utilities.ts
    booking-state.ts, lease-state.ts
/src/services/            orchestrate: transaction + repository + audit
/src/db/                  schema (Drizzle), migrations (SQL), repositories
/src/jobs/                pg-boss workers
/src/lib/                 money.ts (สตางค์), dates.ts (timezone), auth, errors
/tests/                   unit (domain) + integration (DB จริงผ่าน Testcontainers)
```

**Library ที่แนะนำ:** Auth.js (NextAuth v5) · Drizzle ORM · Zod · pg-boss · date-fns + date-fns-tz · React-PDF / Puppeteer สำหรับ PDF · Vitest

---

## 10. แผนการพัฒนา (Phasing)

| เฟส | ขอบเขต |
|---|---|
| **MVP (P1)** | M1, M2, M3 (ยกเว้น LOS), M4-01/02, M5 (manual booking), M6-01–07, M7 (ยกเว้น gateway), M8-01–03, M9-01, M10 (email), M11-01/02/04/05, M12 |
| **Phase 2** | Booking engine สำหรับลูกค้า, PromptPay/gateway, ตรวจสลิปอัตโนมัติ, LINE OA, iCal sync, Housekeeping, แจ้งซ่อม, e-signature, Tenant portal, ตม.30 |
| **Phase 3** | Channel manager เต็มรูปแบบ, dynamic pricing, mobile app |

---

## 11. คำถามที่ต้องการให้ยืนยันก่อนเริ่มทำ

1. **ผู้ใช้ระบบ:** มี Host หลายรายใช้ระบบเดียวกัน (SaaS / multi-tenant) หรือใช้แค่ธุรกิจเดียว?
2. **ลูกค้าจองเองได้ไหมใน MVP** หรือ Host เป็นคนบันทึกการจองอย่างเดียวก่อน?
3. **รอบบิลรายเดือน** ใช้แบบไหนเป็นค่าเริ่มต้น — ตามวันเข้าพัก (anniversary) หรือทุกวันที่ 1?
4. **ค่าน้ำ/ไฟ** คิดตามมิเตอร์จริงหรือเหมาจ่าย? ต้องรองรับอัตราแบบขั้นบันไดไหม?
5. **การชำระเงินออนไลน์** ต้องมีใน MVP หรือบันทึกด้วยมือ + แนบสลิปก่อน?
6. **ใบกำกับภาษี** ต้องออกได้ (จด VAT) หรือแค่ใบเสร็จ?
7. **ช่องทางแจ้งเตือน** หลักคือ Email หรือ LINE?
8. **ภาษา UI:** ไทยอย่างเดียว หรือ ไทย + อังกฤษ?
9. **Sync กับ Airbnb/Booking.com** จำเป็นแค่ไหน (ย้ายไป MVP หรือไม่)?
