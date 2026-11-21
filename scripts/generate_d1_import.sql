-- PEF Design: execute in SUPABASE SQL Editor (PEF project only).
-- Output: one row containing D1 import statements. Export result privately.
-- Never commit the resulting SQL: it contains private user and listing data.
-- This is a read-only query. No Supabase data is changed.
WITH source_rows AS (
 SELECT 1 AS seq, created_at::text AS ordering,
   'INSERT OR IGNORE INTO users (id,email,display_name,created_at,auth_migrated) VALUES (' ||
   quote_nullable(id::text) || ',' || quote_nullable(email) || ',' ||
   quote_nullable(coalesce(raw_user_meta_data->>'display_name','')) || ',' ||
   quote_nullable(created_at::text) || ',0);' AS sql
 FROM auth.users
 UNION ALL
 SELECT 2, created_at::text,
   'INSERT OR IGNORE INTO pef_objects (' ||
   'id,seller_id,title,description,category,price,city,country,whatsapp,video_url,trim_start,trim_end,likes,views,created_at,is_hidden,photos,listing_status,whatsapp_clicks,media_order,promotion_price,negotiable,trade,object_date,video_rotation' ||
   ') VALUES (' ||
   array_to_string(ARRAY[
     quote_nullable(id::text),quote_nullable(seller_id::text),quote_nullable(title),
     quote_nullable(description),quote_nullable(category),quote_nullable(price::text),
     quote_nullable(city),quote_nullable(country),quote_nullable(whatsapp),
     quote_nullable(coalesce(video_url,'')),quote_nullable(trim_start::text),
     quote_nullable(trim_end::text),quote_nullable(likes::text),quote_nullable(views::text),
     quote_nullable(created_at::text),
     coalesce(is_hidden::integer,0)::text,quote_nullable(coalesce(photos::text,'[]')),
     quote_nullable(listing_status),quote_nullable(whatsapp_clicks::text),
     quote_nullable(coalesce(media_order::text,'[]')),quote_nullable(promotion_price::text),
     coalesce(negotiable::integer,0)::text,coalesce(trade::integer,0)::text,
     quote_nullable(object_date),quote_nullable(video_rotation::text)
   ],',') || ');'
 FROM public.pef_objects
 UNION ALL
 SELECT 3, user_id::text,
   'INSERT OR IGNORE INTO pef_seller_profiles (user_id,bio,updated_at,avatar_url,instagram_username) VALUES (' ||
   array_to_string(ARRAY[quote_nullable(user_id::text),quote_nullable(bio),
     quote_nullable(updated_at::text),quote_nullable(avatar_url),quote_nullable(instagram_username)],',') || ');'
 FROM public.pef_seller_profiles
 UNION ALL
 SELECT 4, seller_id::text,
   'INSERT OR IGNORE INTO pef_seller_badges (seller_id,badge,updated_at,display_name) VALUES (' ||
   array_to_string(ARRAY[quote_nullable(seller_id::text),quote_nullable(badge),
     quote_nullable(updated_at::text),quote_nullable(display_name)],',') || ');'
 FROM public.pef_seller_badges
 UNION ALL
 SELECT 5, created_at::text,
   'INSERT OR IGNORE INTO pef_seller_follows (follower_id,seller_id,created_at) VALUES (' ||
   array_to_string(ARRAY[quote_nullable(follower_id::text),quote_nullable(seller_id::text),
     quote_nullable(created_at::text)],',') || ');'
 FROM public.pef_seller_follows
 UNION ALL
 SELECT 6, created_at::text,
   'INSERT OR IGNORE INTO pef_verification_requests (id,seller_id,requested_badge,display_name,business_name,website,registration_number,country,details,status,admin_note,reviewed_at,created_at) VALUES (' ||
   array_to_string(ARRAY[quote_nullable(id::text),quote_nullable(seller_id::text),
     quote_nullable(requested_badge),quote_nullable(display_name),quote_nullable(business_name),
     quote_nullable(website),quote_nullable(registration_number),quote_nullable(country),
     quote_nullable(details),quote_nullable(status),quote_nullable(admin_note),
     quote_nullable(reviewed_at::text),quote_nullable(created_at::text)],',') || ');'
 FROM public.pef_verification_requests
 UNION ALL
 SELECT 7, created_at::text,
   'INSERT OR IGNORE INTO pef_reports (id,object_id,reporter_id,reason,details,created_at) VALUES (' ||
   array_to_string(ARRAY[quote_nullable(id::text),quote_nullable(object_id::text),
     quote_nullable(reporter_id::text),quote_nullable(reason),quote_nullable(details),
     quote_nullable(created_at::text)],',') || ');'
 FROM public.pef_reports
 UNION ALL
 SELECT 8, created_at::text,
   'INSERT OR IGNORE INTO pef_video_jobs (id,seller_id,source_path,output_path,trim_start,music,original_volume,music_volume,listing,status,error,created_at,updated_at) VALUES (' ||
   array_to_string(ARRAY[quote_nullable(id::text),quote_nullable(seller_id::text),
     quote_nullable(source_path),quote_nullable(output_path),quote_nullable(trim_start::text),
     quote_nullable(music),quote_nullable(original_volume::text),quote_nullable(music_volume::text),
     quote_nullable(listing::text),quote_nullable(status),quote_nullable(error),
     quote_nullable(created_at::text),quote_nullable(updated_at::text)],',') || ');'
 FROM public.pef_video_jobs
)
SELECT string_agg(sql,E'\n' ORDER BY seq,ordering) AS d1_import_sql FROM source_rows;
