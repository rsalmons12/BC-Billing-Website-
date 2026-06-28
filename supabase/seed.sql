-- ============================================================================
-- Seed: BC Billing Solutions facility network
-- Run after schema.sql. Edit names/short_names to match exactly what you want
-- facility logins to see. `short_name` is what you'll reference when assigning.
-- ============================================================================
insert into facilities (name, short_name, state) values
  ('KINGSWAY RECOVERY LLC',            'Kingsway',        'NJ'),
  ('RENEWED LIGHT LLC',                'Renewed Light',   'NJ'),
  ('PATHWAYS TREATMENT CENTER LLC',    'Pathways',        'NJ'),
  ('NJ RECOVERY SOLUTIONS LLC',        'NJ Recovery',     'NJ'),
  ('CORE BEHAVIORAL SERVICES LLC',     'Core Behavioral', 'NJ'),
  ('THE WOUNDED HEALER, INC',          'Wounded Healer',  'NJ'),
  ('SHORE BREAK RECOVERY, LLC',        'Shore Break',     'NJ'),
  ('SACRED PSYCHE LTD',                'Sacred Psyche',   'NJ'),
  ('RENOVA RECOVERY, LLC',             'Renova',          'NJ'),
  ('SNJ RECOVERY CENTER LLC',          'SNJ Recovery',    'NJ'),
  ('SOUTH JERSEY RECOVERY CENTER LLC', 'South Jersey',    'NJ'),
  ('MASTERMIND CARE, INC',             'Mastermind',      'NJ'),
  ('EXCLUSIVE RECOVERY CENTER',        'Exclusive',       'NJ')
on conflict do nothing;
