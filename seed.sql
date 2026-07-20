-- aiym-receptionist — seed data (PLAN.md §5.1): demo salon «Керемет».
-- Tenant + masters + services only. Bookings are NOT seeded here — resetDemo()
-- creates the demo occupancy relative to «tomorrow» (§5.3). Run once.
-- admin_token_hash is SHA-256 of the token kept locally in .admin-token.local.

INSERT INTO businesses
  (id, slug, name, assistant_name, address, tz, working_hours, slot_step_min, buffer_min, booking_horizon_days, admin_token_hash, crm_config, limits, is_demo)
VALUES
  (1, 'demo-salon', 'Керемет', 'Айым', 'ул. Розыбакиева 125, Алматы', 'Asia/Almaty',
   '{"mon":[["10:00","20:00"]],"tue":[["10:00","20:00"]],"wed":[["10:00","20:00"]],"thu":[["10:00","20:00"]],"fri":[["10:00","20:00"]],"sat":[["10:00","20:00"]],"sun":[["11:00","18:00"]]}',
   30, 0, 14,
   '834f246d5e42d794ef2b7ad9f78327c83e7772fe5198b275d3d74db9f97a3b63', '{}', '{}', 1);

INSERT INTO resources (id, business_id, name, role) VALUES
  (1, 1, 'Айгерим', 'парикмахер-колорист'),
  (2, 1, 'Инна', 'ногтевой сервис'),
  (3, 1, 'Жанна', 'брови, ресницы, депиляция');

INSERT INTO services (id, business_id, resource_id, name, duration_min, price_kzt, price_from) VALUES
  (1,  1, 1, 'Женская стрижка',                60,  6000,  0),
  (2,  1, 1, 'Мужская стрижка',                30,  4000,  0),
  (3,  1, 1, 'Укладка',                        30,  5000,  0),
  (4,  1, 1, 'Окрашивание в один тон',        150, 20000,  1),
  (5,  1, 1, 'Сложное окрашивание',           180, 30000,  1),
  (6,  1, 2, 'Маникюр с гель-лаком',           90,  8000,  0),
  (7,  1, 2, 'Педикюр',                        90, 10000,  0),
  (8,  1, 3, 'Наращивание ресниц',            120, 10000,  0),
  (9,  1, 3, 'Коррекция и окрашивание бровей', 30,  5000,  0),
  (10, 1, 3, 'Депиляция голеней',              30,  4000,  0);
