# Pre-Booking — Progressive Web App (PWA) Spec (v0.1, รอ approve)

อ้างอิง: `docs/01-functional-design.md` (v1.3), `docs/02-screen-design.md`, หน้าจอ `docs/ui/index.html`, โลโก้ `docs/brand/index.html`

เป้าหมาย: พนักงานติดตั้งแอปลงมือถือ/แท็บเล็ต/คอมได้จากเบราว์เซอร์ (ไม่ต้องผ่าน App Store / Play Store) เปิดเร็ว ใช้งานเต็มจอเหมือนแอป และได้รับแจ้งเตือนฟรี

---

## 1. การติดตั้ง (Installable)

| หัวข้อ | รายละเอียด |
|---|---|
| Web App Manifest | `app/manifest.ts` ของ Next.js · `name: "Pre-Booking"`, `short_name: "Pre-Booking"`, `display: "standalone"`, `start_url: "/?source=pwa"`, `scope: "/"`, `theme_color` = สีมิ้นต์เข้ม, `background_color` = ขาว |
| ไอคอน | สร้างจากโลโก้ **B · Doorway** (ประตูโค้ง + ช่องปฏิทิน, `docs/brand/index.html`): 192 / 512 px (ปกติ) + 512 px `maskable` (เผื่อพื้นที่ปลอดภัย 20%) + `apple-touch-icon` 180 px + favicon SVG/ICO + monochrome icon สำหรับ notification badge |
| Shortcuts | กดค้างที่ไอคอน: **New booking**, **Record payment**, **Meter readings** |
| Android / Chrome / Edge | แสดงแถบ "Install Pre-Booking" ในแอป (ใช้ `beforeinstallprompt`) ครั้งแรกหลัง login · ปิดได้ และไม่ถามซ้ำ 30 วัน |
| iPhone / iPad (Safari) | ไม่มีปุ่มติดตั้งอัตโนมัติ → แสดงคำแนะนำ "Tap Share, then Add to Home Screen" ครั้งเดียว |
| Desktop | ติดตั้งจาก Chrome/Edge เป็นหน้าต่างแยกได้ |

## 2. หน้าจอแบบแอป (App-like UI)

| อุปกรณ์ | Layout |
|---|---|
| มือถือ (< 860px) | **แถบเมนูด้านล่าง 5 ปุ่ม:** Today · Calendar · Bookings · Payments · More · แถบบนแสดงชื่อหน้า + ปุ่ม `+` (New booking) · ฟอร์มเปิดเป็น **bottom sheet** · ตารางเปลี่ยนเป็นรายการการ์ด |
| แท็บเล็ต | sidebar ย่อเหลือไอคอน + ชื่อ, เนื้อหาเต็มจอ |
| Desktop | sidebar เต็มตามเดิม |

- รองรับ safe area ของ iPhone (notch / home indicator) ทุกแถบที่ติดขอบจอ
- ปุ่มกดสูงอย่างน้อย 44px บนมือถือ
- เคารพ dark mode ของเครื่อง
- ดึงลงเพื่อรีเฟรช (pull to refresh) ในหน้ารายการ
- หน้าที่ใช้บนมือถือบ่อย: Today, Check-in/Check-out, Take payment, Meter readings (ออกแบบให้ใช้มือเดียวได้)

## 3. ออฟไลน์ (Service Worker)

ใช้ **Serwist** (`@serwist/next`) สร้าง service worker · ไฟล์ static ทั้งหมดอยู่บน Cloudflare (ใช้ได้กับ OpenNext)

| สถานการณ์ | พฤติกรรม |
|---|---|
| เปิดแอป | โหลด app shell จาก cache ทันที แล้วดึงข้อมูลล่าสุด |
| เน็ตหลุด | แถบบนแจ้ง "You're offline · showing data from 10:42" · ดูข้อมูลล่าสุดที่เคยโหลดได้ (Today, Bookings ที่เปิดล่าสุด, ปฏิทินช่วงปัจจุบัน) |
| สร้าง/แก้การจอง, รับเงิน ตอนออฟไลน์ | **ไม่อนุญาต** — ปุ่มเป็นสีจาง + ข้อความ "Needs a connection" (ป้องกันจองห้องซ้อนและเลขเอกสารผิดลำดับ) |
| จดมิเตอร์ตอนออฟไลน์ | **อนุญาต** — บันทึกลงเครื่อง (IndexedDB) แสดงสถานะ "Waiting to sync (12)" แล้วส่งขึ้นอัตโนมัติเมื่อกลับมาออนไลน์ (Background Sync; Safari ส่งตอนเปิดแอปครั้งถัดไป) |
| ข้อมูลส่วนตัว | cache เฉพาะข้อมูลที่ต้องใช้ ไม่ cache รูปบัตรประชาชน/สลิป · ล้าง cache ทั้งหมดเมื่อ Sign out หรือบัญชีถูกปิด |
| อัปเดตเวอร์ชัน | แจ้ง "New version available · Reload" เมื่อมีการ deploy ใหม่ |

## 4. แจ้งเตือนบนเครื่อง (Web Push) — ฟรี

PWA ส่งแจ้งเตือนเข้ามือถือ/คอมได้ **ฟรีไม่จำกัด** จึงใช้คู่กับ LINE (LINE ยังใช้สำหรับสรุปรายวันเข้ากลุ่ม)

| แจ้งเตือน | ผู้รับ |
|---|---|
| มีการจองใหม่ / ยกเลิก | Front desk + Manager ของที่พักนั้น |
| การจองที่ยังไม่จ่ายใกล้หมดกำหนด (24 ชม.) | Front desk |
| ลูกค้ามาถึงวันนี้แต่ยังจ่ายไม่ครบ (08:00) | Front desk |
| ค่าเช่าเกินกำหนด | Manager + Accountant |
| สัญญาจะหมดใน 30 วัน | Manager |

- ผู้ใช้เลือกเปิด/ปิดแต่ละหัวข้อได้ในหน้า Profile
- **iPhone/iPad ต้องติดตั้งแอปลง Home Screen ก่อน** จึงรับแจ้งเตือนได้ (iOS 16.4 ขึ้นไป)
- ฝั่ง server: เก็บ subscription ในตาราง `push_subscriptions(user_id, endpoint, keys, device_label, created_at)` · ส่งด้วย VAPID จาก Cloudflare Workers (ใช้ไลบรารีที่ทำงานด้วย Web Crypto) · ลบ subscription ที่หมดอายุอัตโนมัติ

## 5. Badge

ตัวเลขบนไอคอนแอป (Badging API) = จำนวนงานที่ต้องทำวันนี้ (ลูกค้ามาถึงที่ยังไม่จ่าย + ค่าเช่าเกินกำหนด) · รองรับบน Chrome/Edge และ iOS ที่ติดตั้งแล้ว

## 6. เกณฑ์ผ่าน

- Lighthouse PWA: installable, มี manifest/service worker ถูกต้อง
- เปิดแอปครั้งที่สองบน 4G ภายใน 1.5 วินาที (app shell จาก cache)
- ทดสอบบน: iPhone Safari (iOS 17+), Android Chrome, Chrome/Edge บน Windows/macOS

## 7. ฟังก์ชันที่เพิ่ม

| ID | ฟังก์ชัน | P |
|---|---|---|
| M14-01 | Manifest + ไอคอน + ติดตั้งได้ (แถบ Install / คำแนะนำ iOS) | 1 |
| M14-02 | Mobile layout: bottom tab bar, bottom sheet, card list | 1 |
| M14-03 | Service worker: app shell cache + แถบออฟไลน์ + แจ้งเวอร์ชันใหม่ | 1 |
| M14-04 | จดมิเตอร์ออฟไลน์ + sync ภายหลัง | 1 |
| M14-05 | Web Push notifications + ตั้งค่าหัวข้อรายคน | 1 |
| M14-06 | App badge + shortcuts | 2 |
