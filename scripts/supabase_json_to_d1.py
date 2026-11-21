#!/usr/bin/env python3
"""Convert a private PEF Supabase JSON export to D1 SQL, preserving UUIDs.

Input JSON must be a local private file containing arrays keyed by table name:
users, pef_objects, pef_seller_profiles, pef_seller_badges,
pef_seller_follows, pef_verification_requests, pef_reports, pef_video_jobs.
Do not commit input or generated SQL: both contain personal information.
This tool performs NO network calls and NO writes to either database.
"""
import argparse
import json
from pathlib import Path

TABLES = {
 "users": ["id","email","display_name","created_at","auth_migrated"],
 "pef_objects": ["id","seller_id","title","description","category","price","city","country","whatsapp","video_url","trim_start","trim_end","likes","views","created_at","is_hidden","photos","listing_status","whatsapp_clicks","media_order","promotion_price","negotiable","trade","object_date","video_rotation"],
 "pef_seller_profiles": ["user_id","bio","updated_at","avatar_url","instagram_username"],
 "pef_seller_badges": ["seller_id","badge","updated_at","display_name"],
 "pef_seller_follows": ["follower_id","seller_id","created_at"],
 "pef_verification_requests": ["id","seller_id","requested_badge","display_name","business_name","website","registration_number","country","details","status","admin_note","reviewed_at","created_at"],
 "pef_reports": ["id","object_id","reporter_id","reason","details","created_at"],
 "pef_video_jobs": ["id","seller_id","source_path","output_path","trim_start","music","original_volume","music_volume","listing","status","error","created_at","updated_at"]
}
BOOL = {"auth_migrated","is_hidden","negotiable","trade"}
JSON = {"photos","media_order","listing"}
def literal(value, column):
 if value is None: return "NULL"
 if isinstance(value,(dict,list)): value=json.dumps(value,ensure_ascii=False,separators=(",",":"))
 if isinstance(value,bool): return "1" if value else "0"
 if column in BOOL and value in (0,1): return str(value)
 if isinstance(value,(int,float)): return str(value)
 return "'" + str(value).replace("'","''") + "'"
def main():
 p=argparse.ArgumentParser()
 p.add_argument("input",type=Path)
 p.add_argument("output",type=Path)
 args=p.parse_args()
 data=json.loads(args.input.read_text(encoding="utf-8"))
 if not isinstance(data,dict): raise ValueError("Expected JSON object")
 if not isinstance(data.get("users"),list): raise ValueError("users array is required for foreign keys")
 lines=["-- PRIVATE DATA: DO NOT COMMIT OR SHARE", "BEGIN TRANSACTION;"]
 for table,columns in TABLES.items():
  rows=data.get(table,[])
  if not isinstance(rows,list): raise ValueError(f"{table} must be an array")
  for row in rows:
   if not isinstance(row,dict): raise ValueError(f"Invalid row in {table}")
   keys=[c for c in columns if c in row]
   if not keys: continue
   values=",".join(literal(row[c],c) for c in keys)
   lines.append(f"INSERT OR REPLACE INTO {table} ({','.join(keys)}) VALUES ({values});")
 lines.append("COMMIT;")
 if args.output.exists(): raise FileExistsError("Output already exists; refusing overwrite")
 args.output.write_text("\n".join(lines)+"\n",encoding="utf-8")
 args.output.chmod(0o600)
 print("Private SQL generated. Verify row counts and backup before importing. Auth passwords NOT migrated.")
if __name__=="__main__": main()
