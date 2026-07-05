# eNGINNo SBS · Commercial

ระบบบริหารวิศวกรรมอาคาร (Building Engineering / Facility Management) สำหรับอาคารพาณิชย์
พัฒนาโดย PSD Engineering Dept. เพื่อเป็นต้นแบบทดแทนโปรแกรม Fixtab ในระยะยาว

ครอบคลุม 27 โมดูล: Dashboard, Building Critical Status, Work Request (WR), PPM, Asset Register,
Energy Monitor, Carbon/ESG, Access Control, Incident, Permit to Work, Parking, Staff Academy,
Tenant/Retail/Event (Commercial-specific), Admin Management และอื่น ๆ

## สถาปัตยกรรม

- **Frontend:** ไฟล์เดียว [`index.html`](index.html) (Chart.js สำหรับกราฟ, SheetJS/XLSX สำหรับ import/export)
  ใช้งานได้แบบ offline-first ผ่าน `localStorage` และ sync ขึ้น backend อัตโนมัติเมื่อออนไลน์
- **Backend/Database:** Google Sheet (เก็บบน Google Drive) + [`apps-script/Code.gs`](apps-script/Code.gs)
  เป็น Web API เชื่อมระหว่างแอปกับชีต
- **Deploy:** GitHub Pages ผ่าน [`.github/workflows/pages.yml`](.github/workflows/pages.yml) — build/deploy อัตโนมัติทุกครั้งที่ push ขึ้น `main`

```
index.html                    ← เว็บแอปทั้งหมด (UI + logic)
apps-script/Code.gs            ← Backend: doGet/doPost บน Google Apps Script
.github/workflows/pages.yml    ← Auto-deploy ไป GitHub Pages
```

## ตั้งค่า Backend (Google Sheet + Apps Script)

1. สร้าง Google Sheet ใหม่ (ว่างเปล่า) — นี่จะเป็นฐานข้อมูลจริงของระบบ เก็บอยู่บน Google Drive ของคุณ
2. เปิดชีต > เมนู **Extensions > Apps Script**
3. ลบโค้ดเดิมทั้งหมดในไฟล์ `Code.gs` แล้ววางเนื้อหาจาก [`apps-script/Code.gs`](apps-script/Code.gs) ของ repo นี้แทน
4. กด **Deploy > New deployment**
   - Select type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. กด Deploy แล้วอนุญาตสิทธิ์ (authorize) ตามที่ Google ขอ
6. คัดลอก **Web app URL** ที่ได้ (รูปแบบ `https://script.google.com/macros/s/XXXXX/exec`)
7. เปิดแอป → Login ด้วยบัญชี Admin → เมนู **Admin Management → 💓 System Health** → วาง URL ในช่อง "GAS Web App URL" → กด "💾 บันทึก + ทดสอบ"
   (ระบบจะทดสอบเชื่อมต่อก่อนบันทึก แล้วโหลดหน้าใหม่อัตโนมัติ — URL จะถูกเก็บเป็น `sbs_gas_url` ใน `localStorage` ของเบราว์เซอร์)

ชีตย่อยแต่ละแท็บ (Users, WR, assets, ppm, ma, inv, energy, ...) จะถูกสร้างอัตโนมัติโดย Code.gs
เมื่อมีการเขียนข้อมูลครั้งแรก ไม่ต้องสร้างเองล่วงหน้า

## โหมด Offline vs Online

- **ยังไม่ตั้งค่า GAS URL (Offline/Demo):** แอปทำงานได้ทันทีด้วยข้อมูลตัวอย่างใน `localStorage`
  ระบบจะสร้างบัญชี Admin ชั่วคราวให้อัตโนมัติในการเปิดใช้งานครั้งแรก และแสดงรหัสผ่านแบบสุ่มให้ครั้งเดียว
  (ไม่มีรหัสผ่าน admin ตายตัวฝังอยู่ใน source code — เพื่อความปลอดภัยเมื่อ repo นี้เป็น public)
- **ตั้งค่า GAS URL แล้ว (Online):** Login/Register/Approve จะตรวจสอบกับ Users sheet บน Google Sheets
  (รหัสผ่านถูก hash ด้วย SHA-256 + salt ฝั่ง Apps Script เท่านั้น) และข้อมูลทุกโมดูล (assets, WR, PPM ฯลฯ)
  จะ sync ขึ้น Sheets แบบอัตโนมัติเมื่อมีการเพิ่ม/แก้ไข/ลบ

## Import ข้อมูลจริงจาก Fixtab

โมดูล Work Request มีปุ่ม **📥 Import Fixtab** พร้อมใช้งานอยู่แล้ว:

1. ตั้งค่า GAS URL ให้เรียบร้อยก่อน (ดูหัวข้อด้านบน)
2. เปิดหน้า Work Request → กด "📥 Import Fixtab" → อัปโหลดไฟล์ Excel export จาก Fixtab (sheet ชื่อ "Ticket Report")
3. เลือกโหมด Import (เพิ่มเฉพาะใหม่ / เพิ่ม+อัปเดต / แทนที่ตามช่วงวันที่ / แทนที่ทั้งหมด) แล้วกัน import
4. ระบบจะแปลงคอลัมน์ Fixtab (Ticket Number, Report Date, Priority, Status Ticket, Branch Name, Technicians ฯลฯ)
   เป็นรูปแบบ WR ของระบบ และ sync ขึ้น Google Sheets เป็นชุด ๆ ละ 500 แถว

รายชื่อสาขา (Branch) 44 สาขาจริงภายใต้ 2 บริษัท (BHIRAJ AND BEYOND VENTURES, บริษัท อะเบ๊าท์ฟู้ด จำกัด)
ถูก map ไว้ใน `BRANCH_MAP_FE` ใน `index.html` แล้ว (อ้างอิงจากคอลัมน์ Branch Address จริงในไฟล์ export)

**ข้อมูลลูกค้าจริง (ชื่อ/เบอร์โทร/อีเมลผู้แจ้ง) จะอยู่ใน Google Sheet เท่านั้น ห้าม commit ไฟล์ export
หรือข้อมูลจริงใด ๆ เข้า git repo นี้เด็ดขาด** (มี `.gitignore` กันไฟล์ `.xlsx/.xls/.csv` ไว้แล้ว)

## Deploy ขึ้น GitHub Pages

Push ขึ้น branch `main` แล้ว GitHub Actions ([`pages.yml`](.github/workflows/pages.yml)) จะ deploy ให้อัตโนมัติ
(ต้องเปิด GitHub Pages source เป็น "GitHub Actions" ใน Settings ของ repo ครั้งแรก)

## System Health — สำหรับตรวจสอบภาพรวมระบบ

`Code.gs` มี endpoint `GET <GAS_URL>?action=health` คืนค่าจำนวนรายการในแต่ละชีต + เวลาล่าสุดที่อัปเดต
โดยไม่ต้อง login และดูได้จากหน้า Admin Management ในแอป (แท็บ "💓 System Health") เช่นกัน

### วิธีขอให้ agent ช่วยตรวจสอบ/รายงานระบบนี้

| ต้องการให้ตรวจ... | เรียก agent |
|---|---|
| การใช้งานเว็บแอป, uptime, error rate | `atom-webapp-analyst` |
| ระบบ IoT/sensor ที่เชื่อมกับอาคาร (ถ้ามี BAS/BMS เชื่อมต่อ) | `arty-iot-reliability` |
| มาตรฐานเทคนิค/วิศวกรรม ตามกฎหมาย/สากล | `chanatip-technical-standards` |
| แนวโน้มตลาด เปรียบเทียบกับ Fixtab/คู่แข่ง | `chayada-market-trends` |
| การเงิน ต้นทุน ROI | `chayanin-finance` |
| deploy, ความปลอดภัย, ฐานข้อมูล | `piyangun-sysadmin` |
| ร่างข้อเสนอ/สรุป requirement ลูกค้า | `tko-proposal-writer` |
| อื่น ๆ ที่ไม่เข้าหมวดข้างต้น | `claude` |

## Security notes

- ไม่มีรหัสผ่านหรือ API key ใดฝังอยู่ใน source code
- รหัสผ่านผู้ใช้ทุกคนถูก hash (salt + SHA-256) ฝั่ง Apps Script เท่านั้น — ไม่มีการเทียบรหัสผ่านแบบ plaintext
- ข้อมูลลูกค้า/พนักงานจริงทั้งหมดอยู่ใน Google Sheet (private) ไม่เคยอยู่ใน git repo (public)
- Anthropic API key (สำหรับ AI Analytics) ผู้ใช้ต้องกรอกเองใน Settings และเก็บใน `localStorage` ของเบราว์เซอร์ตัวเอง

## Roadmap (ยังไม่ทำในรอบนี้)

- แยกไฟล์ `index.html` ออกเป็นโมดูล JS/CSS แยกกัน (ตอนนี้เป็นไฟล์เดียวโดยตั้งใจ เพื่อลดความเสี่ยงต่อของเดิม)
- OAuth/SSO, รองรับหลายภาษา (i18n), offline-first แบบ Service Worker, automated test suite
