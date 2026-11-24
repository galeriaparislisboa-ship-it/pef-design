import os,json,subprocess,tempfile,pathlib,urllib.request,urllib.parse
BASE=os.environ["SUPABASE_URL"].rstrip("/")
KEY=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
HEAD={"apikey":KEY,"Authorization":"Bearer "+KEY}
def request(url,method="GET",body=None,extra=None):
 h={**HEAD,**(extra or {})}
 r=urllib.request.Request(url,data=body,headers=h,method=method)
 try:
  with urllib.request.urlopen(r,timeout=90) as x:return x.read()
 except urllib.error.HTTPError as e:
  detail=e.read(1500).decode('utf-8','replace')
  raise RuntimeError(f'Supabase HTTP {e.code} for {method} {url.split("/rest/v1/")[-1].split("?")[0]}: {detail}') from None
def api(path,method="GET",obj=None):
 return json.loads(request(BASE+"/rest/v1/"+path,method,None if obj is None else json.dumps(obj).encode(),{"Content-Type":"application/json","Prefer":"return=representation"}))
jobs=api("pef_video_jobs?status=eq.pending&order=created_at.asc&limit=10")
music={"chill":"Late-at-Night(chosic.com).mp3","funny":"Monkeys-Spinning-Monkeys(chosic.com).mp3","unplugged":"Monplaisir_-_04_-_Stage_1_Level_24(chosic.com).mp3"}
for job in jobs:
 jid=job["id"]
 try:
  api("pef_video_jobs?id=eq."+jid,"PATCH",{"status":"processing"})
  with tempfile.TemporaryDirectory() as temp:
   src=pathlib.Path(temp)/"source"
   src.write_bytes(request(BASE+"/storage/v1/object/pef-videos/"+urllib.parse.quote(job["source_path"],safe="/")))
   out=pathlib.Path(temp)/"output.mp4"
   cmd=["ffmpeg","-hide_banner","-loglevel","error","-y","-ss",str(job["trim_start"]),"-i",str(src)]
   choice=job["music"];ov=float(job["original_volume"]);mv=float(job["music_volume"])
   if choice!="original":
    m=pathlib.Path(temp)/"music.mp3"
    m.write_bytes(request(BASE+"/storage/v1/object/public/pef-music/"+urllib.parse.quote(music[choice])))
    cmd+=["-stream_loop","-1","-i",str(m)]
    if ov>0:
     cmd+=["-filter_complex",f"[0:a]volume={ov}[orig];[1:a]volume={mv}[music];[orig][music]amix=inputs=2:duration=first[a]","-map","0:v:0","-map","[a]"]
    else:cmd+=["-map","0:v:0","-map","1:a:0","-af",f"volume={mv}"]
   else:
    cmd+=["-map","0:v:0","-map","0:a:0?"]
    if ov!=1:cmd+=["-af",f"volume={ov}"]
   cmd+=["-t","10","-c:v","libx264","-preset","veryfast","-crf","24","-maxrate","1200k","-bufsize","2400k","-pix_fmt","yuv420p","-vf","scale='min(720,iw)':-2","-r","30","-c:a","aac","-b:a","96k","-movflags","+faststart",str(out)]
   subprocess.run(cmd,check=True,timeout=240)
   probe=subprocess.run(["ffprobe","-v","error","-show_entries","stream=codec_name","-of","json",str(out)],capture_output=True,text=True,check=True)
   assert "h264" in probe.stdout and out.stat().st_size>1000
   if api("pef_video_jobs?id=eq."+jid+"&select=status")[0]["status"]=="cancelled":
    print("Cancelled video",jid);continue
   request(BASE+"/storage/v1/object/pef-videos/"+urllib.parse.quote(job["output_path"],safe="/"),"POST",out.read_bytes(),{"Content-Type":"video/mp4","x-upsert":"true"})
   listing=job["listing"];listing["seller_id"]=job["seller_id"];listing["video_url"]=BASE+"/storage/v1/object/public/pef-videos/"+urllib.parse.quote(job["output_path"],safe="/");listing["trim_start"]=0;listing["trim_end"]=10
   if api("pef_video_jobs?id=eq."+jid+"&select=status")[0]["status"]=="cancelled":
    print("Cancelled before publication",jid);continue
   api("pef_objects","POST",listing)
   api("pef_video_jobs?id=eq."+jid+"&status=eq.processing","PATCH",{"status":"ready"})
 except Exception as e:
  print("Video processing failed",jid,repr(e))
  api("pef_video_jobs?id=eq."+jid+"&status=eq.processing","PATCH",{"status":"failed","error":str(e)[:500]})
