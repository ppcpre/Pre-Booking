# Pre-Booking — Functional Design (v0.2, รอ approve)

ระบบให้ **พนักงานของบริษัท** จัดการห้องพักและบันทึกการจอง รองรับการเช่า 3 โหมด: **รายวัน (Daily)**, **รายเดือน (Monthly)**, **รายปี (Yearly)**

| ชั้น | เทคโนโลยี |
|---|---|
| FE | Next.js (App Router) + TypeScript + React · UI ภาษาอังกฤษ |
| BE | Next.js Server Actions / Route Handlers บน Node.js |
| DB | PostgreSQL บน **Supabase** (+ Supabase Auth, Storage, pg_cron) |
| แจ้งเตือน | LINE Official Account (Messaging API, free plan) + แจ้งเตือนในแอป |

> เอกสารนี้เป็นการออกแบบ **ฟังก์ชัน ข้อมูล และกฎทางธุรกิจ** เท่านั้น หน้าจอจะออกแบบหลังจากเอกสารนี้ได้รับการ approve

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
| 1 | แยกการจองระยะสั้นกับสัญญาเช่าระยะยาว | รายวัน = `Booking` · รายเดือน/รายปี = `Booking` + `Lease` |
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
Property (อาคาร)
 ├── RoomType ── RatePlan (DAILY / MONTHLY / YEARLY)
 └── Unit (ห้อง) ── Meter (น้ำ/ไฟ)
       └── Booking ──(MONTHLY/YEARLY)──> Lease
             ├── Guest (ผู้เข้าพักหลัก + ผู้พักร่วม)
             ├── ChargePeriod (งวด: รายคืน / รายเดือน / งวดรายปี) ── ChargeLine
             ├── Payment ── PaymentAllocation ──> ChargePeriod
             ├── Document (ใบแจ้งหนี้ / ใบเสร็จ / ใบกำกับภาษี / ใบลดหนี้)
             └── Deposit ── DepositDeduction
```

### 2.1 โหมดการเช่า

| หัวข้อ | รายวัน | รายเดือน | รายปี |
|---|---|---|---|
| หน่วยราคา | ต่อคืน | ต่อเดือน | ต่อปี หรือ ต่อเดือน (สัญญา 12 เดือน) |
| ระยะขั้นต่ำ | min nights | min months | 12 เดือน |
| เอกสารสัญญา | – | Lease | Lease |
| **งวด (Charge period)** | **1 งวด = 1 คืน** | **1 งวด = 1 เดือน** (นับจากวันเข้า) | ตามรูปแบบชำระ: รายเดือน / 3 เดือน / 6 เดือน / ทั้งปี |
| เงินประกัน | ไม่บังคับ | ตั้งค่าเป็นจำนวนเดือน | ตั้งค่าเป็นจำนวนเดือน |
| ค่าน้ำ/ไฟ | รวมในราคา | ตามมิเตอร์ | ตามมิเตอร์ |
| ยกเลิก/ออกก่อน | Cancellation policy | แจ้งล่วงหน้า N วัน / ริบประกัน | ค่าปรับตามสัญญา |

ห้องเดียวเปิดได้หลายโหมด (`units.allowed_modes`) และทุกโหมดใช้ตารางการจองและปฏิทินเดียวกัน

---

## 3. รายการฟังก์ชัน (Function List)

**P** = Priority (1 = MVP, 2 = เฟส 2) · ~~ขีดฆ่า~~ = ตัดออกจาก v0.1

### M1 — ผู้ใช้และสิทธิ์

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M1-01 | Login | Supabase Auth (email + password), ลืมรหัสผ่าน | 1 |
| M1-02 | จัดการพนักงาน | Admin เชิญพนักงานทางอีเมล, ปิดการใช้งานบัญชี | 1 |
| M1-03 | บทบาท | `ADMIN` (ทุกอย่าง + ตั้งค่า), `MANAGER` (ทุกอย่างยกเว้นจัดการผู้ใช้), `FRONT_DESK` (จอง/เช็กอิน/รับเงิน/จดมิเตอร์), `ACCOUNTANT` (การเงิน/เอกสาร/รายงาน, ดูการจองได้) | 1 |
| M1-04 | ตั้งค่าธุรกิจ | ชื่อ, ที่อยู่, เลขผู้เสียภาษี, สาขา, จดทะเบียน VAT หรือไม่, โลโก้, รูปแบบเลขที่เอกสาร | 1 |

### M2 — อาคารและห้อง

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M2-01 | CRUD Property | ชื่อ, ที่อยู่, เวลาเช็กอิน/เอาต์, วันจดมิเตอร์ประจำเดือน | 1 |
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
| M3-04 | Rate plan รายเดือน | ค่าเช่า/เดือน, ระยะขั้นต่ำ, เงินประกัน (เดือน), ค่าเช่าล่วงหน้า (เดือน) | 1 |
| M3-05 | Rate plan รายปี | ค่าเช่า/ปี หรือส่วนลด % จากรายเดือน, รูปแบบงวด | 1 |
| M3-06 | ค่าบริการเพิ่ม | ทำความสะอาด, คนเพิ่ม, ที่จอดรถ, เน็ต, เฟอร์นิเจอร์ — ต่อการจอง / ต่อคืน / ต่อเดือน / ตอนย้ายออก | 1 |
| M3-07 | อัตราค่าน้ำ/ไฟ | บาท/หน่วย, ค่าขั้นต่ำต่อเดือน, มีผลตั้งแต่วันที่ | 1 |
| M3-08 | การตั้งค่าภาษีตามประเภทรายการ | แต่ละประเภทรายการกำหนด `VAT_7` / `EXEMPT` (ดูหัวข้อ 7.2) | 1 |
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
| M5-01 | สร้างการจอง | เลือกห้อง โหมด วันที่ ผู้เข้าพัก → quote → บันทึก | 1 |
| M5-02 | Hold | ล็อกห้องระหว่างรอมัดจำ มีเวลาหมดอายุ (ตั้งค่าได้ เช่น 24 ชม.) | 1 |
| M5-03 | ยืนยันการจอง | → `CONFIRMED` + สร้างงวด (charge periods) | 1 |
| M5-04 | แก้ไข/ย้ายห้อง | ตรวจห้องว่างใหม่, คำนวณใหม่, ปรับงวดที่ยังไม่จ่าย | 1 |
| M5-05 | ขยายเวลา | รายวัน +คืน · รายเดือน +เดือน (เพิ่มงวด) | 1 |
| M5-06 | ยกเลิก | คำนวณยอดคืน/ริบตาม policy, งวดที่ยังไม่จ่าย → `CANCELLED` | 1 |
| M5-07 | Check-in | เวลาเข้าจริง, เอกสารยืนยันตัวตน, จดมิเตอร์ตอนเข้า | 1 |
| M5-08 | Check-out | เวลาออกจริง, จดมิเตอร์ตอนออก, ตรวจห้อง, สรุปยอดสุดท้าย | 1 |
| M5-09 | No-show | รายวันที่ไม่มาเช็กอิน | 1 |
| M5-10 | Cancellation policy | Flexible / Moderate / Strict / กำหนดเอง | 1 |
| ~~M5-10 เดิม~~ | ~~Booking engine สำหรับลูกค้า~~ | ตัดออก — พนักงานบันทึกเอง | – |

### M6 — สัญญาเช่า (รายเดือน/รายปี)

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
| M7-01 | สร้างงวดอัตโนมัติ | ตอนยืนยันการจอง: รายวัน = งวดละคืน · รายเดือน = งวดละเดือน · รายปี = ตามรูปแบบงวด · + งวดแรกเข้า (เงินประกัน/ค่าแรกเข้า) | 1 |
| M7-02 | **ตารางสถานะงวด** | ดูทุกงวดของการจอง: ช่วงวันที่, ครบกำหนด, ยอด, จ่ายแล้ว, **วันที่จ่าย**, สถานะ | 1 |
| M7-03 | **บันทึกการรับเงิน** | ระบุยอด, **วันที่รับเงิน**, วิธี (เงินสด/โอน/เช็ค/อื่นๆ), เลขอ้างอิง, แนบสลิป (ไม่บังคับ), หมายเหตุ → ระบบตัดเข้างวดเก่าสุดก่อน หรือเลือกงวดเอง | 1 |
| M7-04 | รับเงินบางส่วน | งวดเป็น `PARTIAL` แสดงยอดคงเหลือ | 1 |
| M7-05 | ยกเลิกรายการรับเงิน | void พร้อมเหตุผล → งวดกลับเป็นสถานะเดิม, เอกสารที่ออกไปแล้วต้อง void ตาม | 1 |
| M7-06 | ยกเว้น/ลดยอดงวด | `WAIVED` หรือเพิ่มบรรทัดส่วนลด (ต้องใส่เหตุผล, MANAGER ขึ้นไป) | 1 |
| M7-07 | ค่าปรับจ่ายช้า | เกิน grace period → เพิ่มบรรทัด `LATE_FEE` (เหมา/ต่อวัน, ตั้งค่าได้, ปิดได้) | 1 |
| M7-08 | ภาษีหัก ณ ที่จ่าย | ผู้เช่าเป็นนิติบุคคลหัก 5%: บันทึกยอดหัก + เลขที่หนังสือรับรอง → ยอดงวดถือว่าจ่ายครบ | 1 |
| M7-09 | เงินประกัน | รับ → ถือ → หักค่าเสียหาย (รายการ + รูป) → คืน / ออกบิลเพิ่มถ้าไม่พอ | 1 |
| M7-10 | ยอดค้างชำระ | รายการงวด OVERDUE แยกตามจำนวนวันที่ค้าง | 1 |
| ~~M7-05 เดิม~~ | ~~PromptPay / Payment gateway~~ | ตัดออก | – |

### M8 — จดมิเตอร์

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M8-01 | จดมิเตอร์ทั้งอาคาร | ทุกเดือนตามวันที่ตั้งไว้ กรอกเรียงห้อง (bulk), แนบรูปได้ | 1 |
| M8-02 | จดตอนเข้า/ออก | บังคับตอนเช็กอิน/เช็กเอาต์ของรายเดือน/รายปี | 1 |
| M8-03 | ตรวจค่าผิดปกติ | เลขลดลง, ใช้มากกว่าค่าเฉลี่ย 3 เดือนเกิน X%, ห้องที่ยังไม่ได้จด | 1 |
| M8-04 | คิดค่าน้ำ/ไฟเข้างวด | หน่วยที่ใช้ × เรท (ไม่ต่ำกว่าค่าขั้นต่ำ) → บรรทัดในงวดถัดไป (หัวข้อ 6.4) | 1 |

### M9 — เอกสาร (ใบแจ้งหนี้ / ใบเสร็จ / ใบกำกับภาษี)

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M9-01 | ใบแจ้งหนี้ (Invoice) | ออกจากงวด (รายเดือน/รายปี) หรือทั้งการจอง (รายวัน) | 1 |
| M9-02 | ใบเสร็จรับเงิน / ใบกำกับภาษี | ออกจากรายการรับเงิน · ถ้ามีรายการต้องเสีย VAT → "Receipt / Tax Invoice" · ถ้ายกเว้นทั้งหมด → "Receipt" | 1 |
| M9-03 | ใบกำกับภาษีเต็มรูป | ข้อมูลผู้ซื้อ: ชื่อ, ที่อยู่, เลขผู้เสียภาษี, สาขา (ดึงจากผู้เข้าพัก/บริษัท แก้ได้ก่อนออก) | 1 |
| M9-04 | เลขที่เอกสาร | เลขต่อเนื่องแยกตามประเภทและปี เช่น `INV-2026-00001`, `RT-2026-00001`, `CN-2026-00001` | 1 |
| M9-05 | Void + ออกใหม่ / ใบลดหนี้ | ห้ามลบ ห้ามแก้หลังออกแล้ว | 1 |
| M9-06 | PDF + พิมพ์ซ้ำ (สำเนา) | เก็บ PDF ใน Storage, พิมพ์ซ้ำมีคำว่า "COPY" | 1 |
| M9-07 | รายงานภาษีขาย | รายการใบกำกับภาษีรายเดือน (ยื่น ภ.พ.30) | 1 |

### M10 — ผู้เข้าพัก/ผู้เช่า

| ID | ฟังก์ชัน | รายละเอียด | P |
|---|---|---|---|
| M10-01 | ข้อมูลผู้เข้าพัก | ชื่อ, เบอร์, อีเมล, LINE ID, สัญชาติ, ที่อยู่สำหรับออกใบกำกับ | 1 |
| M10-02 | ผู้เช่าเป็นบริษัท | ชื่อบริษัท, เลขผู้เสียภาษี, สาขา (ใช้ออกใบกำกับและคิดหัก ณ ที่จ่าย) | 1 |
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
| M12-04 | รายงานภาษีขาย | 1 |
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
`ISSUED → VOID` (ไม่มี draft สำหรับใบเสร็จ/ใบกำกับ — ออกแล้วถือว่าออก)

---

## 5. การบันทึกการรับเงินและสถานะรายงวด (รายละเอียด)

### 5.1 การสร้างงวด

| โหมด | งวด | วันครบกำหนด (ค่าเริ่มต้น) |
|---|---|---|
| รายวัน | งวดที่ 0: มัดจำการจอง (ถ้ามี) · งวดที่ 1..N: คืนละ 1 งวด `[d, d+1)` | วันเช็กอิน (หรือตั้งค่าให้เป็นวันของคืนนั้น) |
| รายเดือน | งวดที่ 0: เงินประกัน + ค่าแรกเข้า · งวดที่ 1..N: `[วันเข้า + (n−1) เดือน, วันเข้า + n เดือน)` | วันแรกของงวด (+ grace days) |
| รายปี | งวดที่ 0: เงินประกัน · งวดค่าเช่าตามรูปแบบ (12 / 4 / 2 / 1 งวด) · ค่าน้ำ/ไฟเป็นงวดรายเดือนแยก ถ้าค่าเช่าไม่ได้จ่ายรายเดือน | วันแรกของงวด |

- **ค่าเช่าล่วงหน้า M เดือน** = งวดที่ 1..M มีวันครบกำหนดเป็นวันทำสัญญา
- **วันที่ 29–31:** ถ้าเดือนนั้นไม่มีวันที่ดังกล่าว ใช้วันสุดท้ายของเดือน (เข้า 31 ม.ค. → งวดถัดไป 28/29 ก.พ. → 31 มี.ค.)
- **รายวันพักยาว:** 1 คืน = 1 งวด ทำให้เห็นสถานะรายวันได้ ใบแจ้งหนี้รวมหลายคืนเป็นใบเดียวได้

### 5.2 ขั้นตอนบันทึกรับเงิน

```
1. เปิดการจอง → ดูตารางงวด (สถานะ + ยอดคงเหลือ)
2. กด "Record payment"
3. กรอก: ยอดเงิน, วันที่รับเงิน (ค่าเริ่มต้น = วันนี้, ย้อนหลังได้), วิธีชำระ, เลขอ้างอิง, สลิป (optional), หัก ณ ที่จ่าย (optional)
4. เลือกการตัดยอด: [อัตโนมัติ: งวดเก่าสุดก่อน] หรือ [เลือกงวดเอง]
5. บันทึก (transaction เดียว): payments + payment_allocations + อัปเดตยอด/สถานะงวด + audit log
6. ถามว่าจะออก "Receipt / Tax Invoice" เลยไหม → ออกเลขที่ + PDF
```

- รับเงินเกินยอด → เก็บเป็น **เครดิตคงเหลือ** ของการจอง ใช้ตัดงวดถัดไปได้
- วันที่ `paid_at` ของงวด = วันที่ของรายการรับเงินที่ทำให้งวดนั้นจ่ายครบ

### 5.3 มุมมองสถานะ (สำหรับออกแบบหน้าจอ)
- **ในการจอง:** ตารางงวดพร้อม badge สถานะ
- **ภาพรวม (Payment status board):** แกนห้อง × เดือน (รายเดือน/รายปี) หรือ ห้อง × วัน (รายวัน) แต่ละช่องเป็นสีตามสถานะงวด

---

## 6. กฎการคำนวณราคา

### 6.1 รายวัน
```
for each night in [check_in, check_out):
    price = date_override ?? seasonal_rate ?? (isFriSat ? weekend_rate : base_rate)
subtotal = Σ price − LOS discount (เฟส 2)
fees     = cleaning + extra guest × nights + add-ons
total    = subtotal + fees   (VAT คิดตามการตั้งค่า inclusive/exclusive)
```
ตรวจ min/max nights, max occupancy · ถ้าพัก ≥ 28 คืน แนะนำให้เปลี่ยนเป็นรายเดือน

### 6.2 รายเดือน (Anniversary)
- ไม่มีการคิดตามสัดส่วน — ทุกงวดเต็มเดือนตามวันเข้า
- **งวดสุดท้ายกรณีออกกลางงวด:** ตั้งค่าได้ `FULL_PERIOD` (เก็บเต็มงวด — ค่าเริ่มต้น) หรือ `DAILY_PRORATE` (คิดรายวัน = ค่าเช่า ÷ จำนวนวันในงวด)
- งวดค่าเช่า = ค่าเช่า + ค่าบริการรายเดือน + ค่าน้ำ/ไฟของรอบก่อน (6.4)

### 6.3 รายปี
- ราคา: ต่อปี หรือ ส่วนลด % จากรายเดือน · รูปแบบงวด MONTHLY / QUARTERLY / SEMI_ANNUAL / ANNUAL
- ยกเลิกก่อนกำหนด: ตาม `early_termination_rule` (เช่น ริบเงินประกัน หรือ ค่าเช่า X เดือน)

### 6.4 ค่าน้ำ/ไฟตามมิเตอร์
- **จดทั้งอาคารเดือนละครั้ง** ตามวันที่ตั้งไว้ (เช่น วันที่ 25) + จดตอนเข้า/ออก
- หน่วยที่ใช้ = เลขครั้งนี้ − เลขครั้งก่อนในช่วงที่ผู้เช่าอยู่ (ถ้าเปลี่ยนมิเตอร์ ใช้เลขเริ่มต้นของมิเตอร์ใหม่)
- ยอด = max(หน่วย × เรท, ค่าขั้นต่ำ) โดยใช้เรทที่มีผล ณ วันจด
- **นำเข้างวด:** เพิ่มเป็นบรรทัด `WATER` / `ELECTRIC` ในงวดค่าเช่าถัดไปที่ยังไม่ PAID · ถ้าไม่มี (เช่น รายปีจ่ายทั้งปี) สร้างงวด `UTILITY` แยก
- **ตอนย้ายออก:** มิเตอร์ตอนออก → บรรทัดในงวดสุดท้าย หรือหักจากเงินประกัน

### 6.5 Cancellation policy (รายวัน)
เก็บเป็น rules `[{days_before, refund_percent}]` และเก็บสำเนา (snapshot) ไว้ในการจอง

---

## 7. ใบเสร็จและใบกำกับภาษี

### 7.1 ข้อมูลบนใบกำกับภาษีเต็มรูป (ตามประมวลรัษฎากร ม.86/4)
1. คำว่า "ใบกำกับภาษี" (เด่นชัด)
2. ชื่อ ที่อยู่ เลขประจำตัวผู้เสียภาษีของผู้ขาย + สำนักงานใหญ่/สาขา
3. ชื่อ ที่อยู่ ของผู้ซื้อ (+ เลขผู้เสียภาษีและสาขา ถ้าผู้ซื้อจดทะเบียน VAT)
4. เลขที่เอกสาร
5. รายการ จำนวน มูลค่า
6. ภาษีมูลค่าเพิ่ม แยกจากมูลค่าสินค้า/บริการ
7. วันที่ออก

ระบบออกเป็น **"ใบเสร็จรับเงิน/ใบกำกับภาษี" (Receipt / Tax Invoice)** ใบเดียว ณ วันที่รับเงิน (ภาษีของบริการเกิดเมื่อได้รับชำระ)

### 7.2 ⚠️ VAT แยกตามประเภทรายการ (ควรยืนยันกับนักบัญชี)
- **ให้เช่าที่พักรายวัน (โรงแรม/ที่พักชั่วคราว)** โดยทั่วไป **ต้องเสีย VAT**
- **ให้เช่าห้องเพื่ออยู่อาศัยระยะยาว (อสังหาริมทรัพย์)** โดยทั่วไป **ได้รับยกเว้น VAT** แต่ค่าบริการอื่น (เฟอร์นิเจอร์, ทำความสะอาด, ค่าน้ำ/ไฟที่เรียกเก็บต่อ ฯลฯ) อาจต้องเสีย VAT

ระบบจึงให้ตั้งค่า `vat_mode` **ต่อประเภทรายการ × โหมด** แทนการตั้งค่าเดียวทั้งระบบ · ใบเอกสารแสดง: มูลค่าที่เสียภาษี, VAT 7%, มูลค่าที่ได้รับยกเว้น แยกกัน · ถ้าธุรกิจไม่ได้จดทะเบียน VAT ระบบออกได้แค่ "Receipt"

### 7.3 ภาษาบนเอกสาร
UI เป็นภาษาอังกฤษ แต่เอกสารภาษีต้องเป็นภาษาไทย → แนะนำ **เอกสาร 2 ภาษา (TH/EN)**

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
| **Auth** | Email/password, admin เชิญพนักงาน (`auth.admin.inviteUserByEmail`), ตาราง `profiles` (role) ผูกกับ `auth.users` |
| **RLS** | เปิดทุกตาราง · policy ตาม role ผ่านฟังก์ชัน `app.current_role()` · ฝั่ง client อ่านได้เฉพาะที่จำเป็น การเขียนทั้งหมดผ่าน server |
| **Data access ฝั่ง server** | **Drizzle ORM** ต่อผ่าน Supavisor (transaction mode, `prepare: false`) สำหรับ business logic ที่ต้องใช้ transaction · ใช้ `@supabase/ssr` สำหรับ session/auth |
| **Storage** | Private buckets: `slips`, `id-documents`, `contracts`, `documents` (PDF), `meter-photos` · เข้าถึงผ่าน signed URL อายุสั้น |
| **Scheduled jobs** | `pg_cron` สำหรับงาน SQL ล้วน · งานที่ต้องใช้ TypeScript (ส่ง LINE, สร้าง PDF) ให้ `pg_cron` + `pg_net` เรียก Route Handler `/api/cron/*` ที่ป้องกันด้วย secret |
| **Region** | Singapore (`ap-southeast-1`) ใกล้ไทยที่สุด |
| **Backup** | Free plan ไม่มี PITR และ **โปรเจกต์ถูกพักเมื่อไม่มีการใช้งาน 7 วัน** → สำหรับใช้งานจริงแนะนำ Pro plan |

---

## 10. งานอัตโนมัติ (Scheduled Jobs)

| Job | ความถี่ | ทำงานที่ | หน้าที่ |
|---|---|---|---|
| `expire_holds` | ทุก 5 นาที | pg_cron (SQL) | HOLD ที่หมดเวลา → EXPIRED |
| `refresh_period_status` | ทุกวัน 00:05 | pg_cron (SQL) | UPCOMING→DUE, DUE/PARTIAL→OVERDUE |
| `apply_late_fees` | ทุกวัน 00:10 | pg_cron (SQL) | เพิ่ม/อัปเดตบรรทัด LATE_FEE (idempotent ต่องวด) |
| `mark_no_show` | ทุกวัน (หลังเวลาตัด) | pg_cron (SQL) | รายวันที่ไม่เช็กอิน → NO_SHOW |
| `lease_lifecycle` | ทุกวัน | pg_cron (SQL) | สัญญาถึงวันสิ้นสุด → ENDED |
| `daily_digest` | ทุกวัน 08:00 (เวลาไทย) | `/api/cron/daily-digest` | ส่งสรุปเข้ากลุ่ม LINE + แจ้งเตือนในแอป |
| `ical_sync` | ทุก 15 นาที | เฟส 2 | |

ทุก job ต้อง **idempotent** (รันซ้ำแล้วผลเหมือนเดิม) · หมายเหตุ: pg_cron ใช้เวลา UTC → 08:00 ไทย = `0 1 * * *`

---

## 11. Database Schema (PostgreSQL / Supabase — ร่าง)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE rental_mode     AS ENUM ('DAILY','MONTHLY','YEARLY');
CREATE TYPE booking_status  AS ENUM ('HOLD','CONFIRMED','CHECKED_IN','CHECKED_OUT','CLOSED','CANCELLED','NO_SHOW','EXPIRED');
CREATE TYPE booking_kind    AS ENUM ('RESERVATION','BLOCK');
CREATE TYPE pay_frequency   AS ENUM ('MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL');
CREATE TYPE lease_status    AS ENUM ('DRAFT','ACTIVE','NOTICE_GIVEN','ENDED','TERMINATED','RENEWED');
CREATE TYPE period_kind     AS ENUM ('MOVE_IN','NIGHT','RENT','UTILITY','MOVE_OUT','ADJUSTMENT');
CREATE TYPE period_status   AS ENUM ('UPCOMING','DUE','PARTIAL','OVERDUE','PAID','WAIVED','CANCELLED');
CREATE TYPE vat_mode        AS ENUM ('VAT_7','EXEMPT');
CREATE TYPE doc_type        AS ENUM ('INVOICE','RECEIPT','RECEIPT_TAX_INVOICE','CREDIT_NOTE');
CREATE TYPE user_role       AS ENUM ('ADMIN','MANAGER','FRONT_DESK','ACCOUNTANT');

-- ===== ผู้ใช้ & ตั้งค่า =====
CREATE TABLE profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  text NOT NULL,
  role       user_role NOT NULL DEFAULT 'FRONT_DESK',
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_settings (           -- มีแถวเดียว
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  legal_name         text NOT NULL,
  address            text NOT NULL,
  tax_id             text,
  branch             text NOT NULL DEFAULT 'Head Office',
  vat_registered     boolean NOT NULL DEFAULT false,
  hold_hours         int  NOT NULL DEFAULT 24,
  line_group_id      text,
  line_push_monthly_limit int NOT NULL DEFAULT 200,
  logo_file_id       uuid
);

-- ===== อาคาร & ห้อง =====
CREATE TABLE properties (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  address              text,
  check_in_time        time NOT NULL DEFAULT '14:00',
  check_out_time       time NOT NULL DEFAULT '12:00',
  meter_reading_day    int  NOT NULL DEFAULT 25 CHECK (meter_reading_day BETWEEN 1 AND 28),
  grace_days           int  NOT NULL DEFAULT 5,
  late_fee_rule        jsonb,             -- {type:'PER_DAY'|'FLAT', amount, max_amount}
  move_out_billing     text NOT NULL DEFAULT 'FULL_PERIOD' CHECK (move_out_billing IN ('FULL_PERIOD','DAILY_PRORATE')),
  turnover_buffer_days int  NOT NULL DEFAULT 0
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
  pay_frequency    pay_frequency,         -- YEARLY
  vat_inclusive    boolean NOT NULL DEFAULT true,
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

CREATE TABLE charge_types (              -- ประเภทรายการ + การตั้งค่า VAT
  code        text PRIMARY KEY,           -- NIGHTLY, RENT, WATER, ELECTRIC, CLEANING, PARKING, FURNITURE, LATE_FEE, DEPOSIT ...
  name        text NOT NULL,
  vat_daily   vat_mode NOT NULL DEFAULT 'VAT_7',
  vat_long    vat_mode NOT NULL DEFAULT 'EXEMPT',
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
  billing_name    text,           -- ชื่อบนใบกำกับ (บุคคล/บริษัท)
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
  code             text UNIQUE NOT NULL,          -- BK-2026-000123
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
  pay_frequency          pay_frequency NOT NULL DEFAULT 'MONTHLY',
  deposit_amount         bigint NOT NULL DEFAULT 0,
  notice_days            int NOT NULL DEFAULT 30,
  early_termination_rule jsonb,
  previous_lease_id      uuid REFERENCES leases(id),
  signed_file_id         uuid,
  notice_given_on        date,
  planned_move_out       date
);

-- ===== งวด (สถานะรายวัน/รายเดือน) =====
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
  vat_mode    vat_mode NOT NULL,
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
  number         text UNIQUE NOT NULL,            -- RT-2026-00001
  booking_id     uuid NOT NULL REFERENCES bookings(id),
  payment_id     uuid REFERENCES payments(id),    -- ใบเสร็จ
  period_ids     uuid[],                          -- ใบแจ้งหนี้
  ref_document_id uuid REFERENCES documents(id),  -- ใบลดหนี้อ้างใบเดิม
  issue_date     date NOT NULL,
  seller         jsonb NOT NULL,                  -- snapshot ข้อมูลผู้ขาย
  buyer          jsonb NOT NULL,                  -- snapshot ข้อมูลผู้ซื้อ
  lines          jsonb NOT NULL,                  -- snapshot รายการ
  vatable_amount bigint NOT NULL DEFAULT 0,
  vat_amount     bigint NOT NULL DEFAULT 0,
  exempt_amount  bigint NOT NULL DEFAULT 0,
  total          bigint NOT NULL,
  pdf_file_id    uuid,
  status         text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','VOID')),
  void_reason    text,
  issued_by      uuid REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_sequences (
  prefix  text,             -- BK, INV, RT, RC, CN
  year    int,
  last_no int NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year)
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

---

## 12. Server Functions (Server Actions / Route Handlers)

UI ใช้งานภายในบริษัทเท่านั้น → การเขียนข้อมูลใช้ **Server Actions** · Route Handlers ใช้กับ cron, LINE webhook, ดาวน์โหลด PDF/CSV · ทุก action: ตรวจ session + role → validate ด้วย Zod → เรียก service → audit log

| กลุ่ม | ฟังก์ชัน |
|---|---|
| Inventory | `createProperty`, `updateProperty`, `createRoomType`, `createUnit`, `updateUnit`, `createBlock`, `removeBlock` |
| Pricing | `upsertRatePlan`, `upsertRateOverride`, `upsertFee`, `upsertUtilityRate`, `upsertChargeType`, `getQuote(input)` |
| Availability | `searchAvailability({from,to,mode,guests,roomTypeId})`, `getCalendar({propertyId,from,to})`, `getUpcomingVacancies(days)` |
| Booking | `createBooking`, `confirmBooking`, `updateBooking(version)`, `extendBooking`, `cancelBooking`, `checkIn`, `checkOut`, `markNoShow` |
| Lease | `createLease`, `generateLeasePdf`, `attachSignedLease`, `giveNotice`, `renewLease`, `terminateLease` |
| Periods & Payments | `getPeriods(bookingId)`, `getPaymentBoard({propertyId, month})`, `recordPayment`, `voidPayment`, `waivePeriod`, `addAdjustment`, `recordRefund` |
| Meters | `getMeterSheet({propertyId,date})`, `saveMeterReadings(bulk)`, `billUtilities({propertyId,date})` |
| Deposits | `settleDeposit({deductions[]})` |
| Documents | `issueInvoice`, `issueReceipt(paymentId)`, `voidDocument`, `issueCreditNote`, `downloadPdf` |
| Reports | `occupancyReport`, `revenueReport`, `arAgingReport`, `depositReport`, `salesTaxReport`, `exportCsv` |
| System | `/api/cron/daily-digest`, `/api/line/webhook`, `inviteUser`, `updateUserRole` |

**รหัส error สำคัญ:** `BOOKING_CONFLICT` (ห้องไม่ว่าง — จาก exclusion constraint `23P01`), `VERSION_CONFLICT`, `HOLD_EXPIRED`, `RULE_VIOLATION`, `PERIOD_ALREADY_PAID`, `DOCUMENT_LOCKED`

---

## 13. โครงสร้างโค้ด

```
/app/(app)/...              หน้าจอ (ทำหลัง approve)
/app/api/cron/*             งานตามเวลา (ป้องกันด้วย CRON_SECRET)
/app/api/line/webhook       รับข้อความจาก LINE (ตรวจ signature)
/src/domain/                กฎธุรกิจล้วน (ไม่มี I/O) → unit test
    pricing/{daily,monthly,yearly,quote}.ts
    periods.ts  utilities.ts  cancellation.ts  vat.ts
    booking-state.ts  lease-state.ts  period-status.ts
/src/server/actions/        Server Actions
/src/server/services/       transaction + repository + audit
/src/db/schema.ts           Drizzle schema
/supabase/migrations/       SQL migrations (constraints, RLS, pg_cron)
/src/lib/                   money, dates (Asia/Bangkok), supabase clients, line, pdf
/tests/                     Vitest (domain) + integration (Supabase local)
```

**Library:** `@supabase/ssr` · Drizzle ORM · Zod · date-fns + `@date-fns/tz` · `@line/bot-sdk` · React-PDF (รองรับฟอนต์ไทย เช่น Sarabun) · Vitest

---

## 14. แผนการพัฒนา

| เฟส | ขอบเขต |
|---|---|
| **MVP** | M1–M10 (P1), M11-01/02/03, M12 (P1), M13 |
| **เฟส 2** | iCal sync, ส่วนลดตามระยะพัก, month-to-month, แจ้งเตือนผู้เช่าทาง LINE, housekeeping/แจ้งซ่อม, blacklist, ตม.30, ADR/RevPAR |

---

## 15. คำถามที่เหลือ (ยืนยันก่อนออกแบบหน้าจอ)

1. **สถานะรายวัน:** การจองรายวันให้แยก **1 งวดต่อคืน** (เห็นสถานะจ่ายแล้ว/ยังไม่จ่ายทีละวัน) ตามที่ออกแบบไว้ใช่ไหม? หรือรายวันให้เป็น **1 งวดต่อการจอง**?
2. **บริษัทจดทะเบียน VAT แล้วหรือยัง?** และ VAT แยกตามประเภทรายการ (หัวข้อ 7.2) ได้ยืนยันกับนักบัญชีแล้วหรือยัง?
3. **ภาษาบนใบเสร็จ/ใบกำกับภาษี:** ใช้ **2 ภาษา TH/EN** ตามที่แนะนำ ได้ไหม?
4. **อาคาร:** มีกี่อาคาร และประมาณกี่ห้อง? (ใช้ประเมินขนาดและวางหน้าจอจดมิเตอร์)
5. **Hosting:** deploy Next.js บน **Vercel** ได้ไหม?
