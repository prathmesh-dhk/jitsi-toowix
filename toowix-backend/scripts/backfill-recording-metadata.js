const { connectDatabase, disconnectDatabase } = require('/app/dist/src/db/connection');
const { Recording } = require('/app/dist/src/models/Recording');
const { inspectRecording } = require('/app/dist/src/recordings/media');
(async()=>{ await connectDatabase();
 const recordings=await Recording.find({fileUrl:{$exists:true,$ne:null}});
 for(const record of recordings){
  try { const media=await inspectRecording(record.fileUrl);
   await Recording.updateOne({_id:record._id},{$set:{durationSeconds:media.durationSeconds,durationMinutes:media.durationSeconds/60,sizeBytes:media.sizeBytes,status:'Ready',recordingSessionId:record.fileUrl.split('/')[0]},$unset:{failureReason:1}});
   console.log(JSON.stringify({id:String(record._id),durationSeconds:media.durationSeconds,sizeBytes:media.sizeBytes,status:'Ready'}));
  }catch { console.log(JSON.stringify({id:String(record._id),status:'validation failed; metadata unchanged'})); }
 }
 await disconnectDatabase();
})().catch(()=>{console.error('Metadata backfill failed');process.exitCode=1});
