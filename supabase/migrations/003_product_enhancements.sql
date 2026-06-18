-- Featured products + richer sample description
alter table products
  add column if not exists is_featured boolean not null default false;

update products
set
  is_featured = true,
  description = 'ใบพัดลมคุณภาพดี ราคาส่ง เหมาะสำหรับงานอุตสาหกรรมและร้านค้า วัสดุพลาสติกแข็งแรง มีหลายสี (ขาว ดำ แดง) ขนาดมาตรฐาน ใช้กับมอเตอร์ทั่วไป พร้อมส่ง'
where name = 'ใบพัดลม';

create index if not exists products_is_featured_idx
  on products (is_featured)
  where is_active = true and is_featured = true;
