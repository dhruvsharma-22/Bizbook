-- Set the intended default to three email reminders and two WhatsApp reminders.
-- Preserve any schedule that a Company Admin has already customized.
update public.platform_reminder_policy
set schedule = jsonb_build_array(
  jsonb_build_object('reminder_number', 1, 'day_offset', -7, 'channel', 'Email', 'send_time', '09:00'),
  jsonb_build_object('reminder_number', 2, 'day_offset', -3, 'channel', 'Email', 'send_time', '09:00'),
  jsonb_build_object('reminder_number', 3, 'day_offset', -1, 'channel', 'WhatsApp', 'send_time', '09:00'),
  jsonb_build_object('reminder_number', 4, 'day_offset', 0, 'channel', 'WhatsApp', 'send_time', '09:00'),
  jsonb_build_object('reminder_number', 5, 'day_offset', 1, 'channel', 'Email', 'send_time', '09:00')
)
where id is true
  and schedule = jsonb_build_array(
    jsonb_build_object('reminder_number', 1, 'day_offset', -3, 'channel', 'Email', 'send_time', '09:00'),
    jsonb_build_object('reminder_number', 2, 'day_offset', -2, 'channel', 'Email', 'send_time', '09:00'),
    jsonb_build_object('reminder_number', 3, 'day_offset', -1, 'channel', 'WhatsApp', 'send_time', '09:00'),
    jsonb_build_object('reminder_number', 4, 'day_offset', 0, 'channel', 'WhatsApp', 'send_time', '09:00'),
    jsonb_build_object('reminder_number', 5, 'day_offset', 1, 'channel', 'WhatsApp', 'send_time', '09:00')
  );
