-- Sample product for development/testing
insert into products (name, description, stock_qty, is_active)
values (
  'ใบพัดลม',
  'ใบพัดลมคุณภาพดี ราคาส่ง',
  50000,
  true
);

insert into product_price_tiers (product_id, min_qty, unit_price, sort_order)
select id, 10000, 5.00, 0 from products where name = 'ใบพัดลม';

insert into product_price_tiers (product_id, min_qty, unit_price, sort_order)
select id, 100, 7.00, 1 from products where name = 'ใบพัดลม';

insert into product_price_tiers (product_id, min_qty, unit_price, sort_order)
select id, 1, 10.00, 2 from products where name = 'ใบพัดลม';
