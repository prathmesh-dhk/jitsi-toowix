const { connectDatabase, disconnectDatabase } = require('/app/dist/src/db/connection');
const { User } = require('/app/dist/src/models/User');
const { Meeting } = require('/app/dist/src/models/Meeting');
const jwt = require('/app/node_modules/jsonwebtoken');
require('/app/node_modules/dotenv').config({path:'/app/.env'});
(async () => {
 await connectDatabase();
 const owner = await User.findOne({ status:'ACTIVE', role: { $in:['COMPANY_ADMIN','HOST','SUPER_ADMIN'] } });
 if (!owner) throw new Error('No authorized host available for test');
 const room = 'verification-recording-' + Date.now();
 const meeting = await Meeting.create({name:'Recording verification (synthetic media)',roomSlug:room,type:'Guest',createdBy:owner._id,companyId:owner.companyId});
 const token = name => jwt.sign({iss:process.env.JITSI_APP_ID || 'toowix-meet',aud:process.env.JITSI_APP_ID || 'toowix-meet',sub:process.env.JITSI_DOMAIN || 'talk.toowix.com',room,context:{user:{id:name,name,moderator:true},features:{moderator:true,recording:true}}},process.env.JITSI_APP_SECRET,{algorithm:'HS256',expiresIn:'15m'});
 console.log('TEST_CONTEXT '+JSON.stringify({room,hostToken:token('Recording verification A'),guestToken:token('Recording verification B')}));
 await disconnectDatabase();
})().catch(() => { console.error('Could not create recording verification context'); process.exitCode=1; });
