// Owner-reviewed revisions. Not used by live sends until submitted and approved.
const {ADDRESS,DIRECTIONS_PDF,definitions:activeDefinitions}=require('./reminderTemplates');
const chinese=`尊敬的茶友：

茶之相博物馆•观颐养性茶空间欢迎您明天莅临我们的茶空间！

🕰️ 为方便您预留充足的出行时间，以下是明天的活动流程：

{{1}} - {{2}}：签到
{{3}} - {{4}}：茶荟介绍及入座静待茶荟开始
{{5}}：茶荟正式开始

注意：为了让每位茶友都能享有最佳体验，茶荟开始后，我们可能无法安排迟到的茶友入场，敬请谅解。

温馨提醒：
●请穿宽松舒适、适合静坐的上衣和长裤。茶荟时间请穿袜子。
●请避免食用葱、姜、蒜、咖喱及其他辛辣食物，避免饮酒。活动前1小时请避免进食。
●茶荟可能流汗，若必要请自行携带更换的衣物。
●请避免使用香水。
明天{{6}}见！祝您有愉快的一天。`;
const english=[
    'Dear Tea Friends,', '',
    'Authentic Tea Essence Museum•Guanyiyangxing Tea Space welcomes you to our tea space tomorrow!', '',
    '🕰️ To help you plan your travel, here is tomorrow’s schedule.', '',
    '{{1}} - {{2}}: Registration ',
    '{{3}} - {{4}}: Tea Session introduction; take your seat and wait quietly for the session to begin ',
    '{{5}}: Tea Session begins', '',
    'Please note: To give everyone the best experience, we may not be able to admit late arrivals once the session has begun. Thank you for your understanding.', '',
    'Gentle reminders: ',
    '●Wear loose, comfortable tops and long pants suitable for sitting. Please wear socks for the session.', ' ',
    '●Avoid onion, ginger, garlic, curry, other spicy foods and alcohol. Please avoid eating for 1 hour before the session. ', '',
    '●You may perspire during the tea session. Bring a change of clothes if needed. ', '',
    '●Please avoid wearing perfume. ', '',
    'See you tomorrow {{6}}! Have a lovely day ahead.'
].join('\n');
const samples=['4:00pm','4:15pm','4:15pm','4:30pm','4:30pm'];
const definitions=[
    {name:'tea_session_reminder_full_en_v3',language:'en',category:'UTILITY',components:[{
        type:'BODY',text:english,example:{body_text:[[...samples,'afternoon']]}
    }]},
    {name:'tea_session_reminder_full_zh_v3',language:'zh_CN',category:'UTILITY',components:[{
        type:'BODY',text:chinese,example:{body_text:[[...samples,'下午']]}
    }]},
    structuredClone(activeDefinitions[2])
];
function parameters(booking){
    const start=new Date(`${booking.booking_date}T${booking.booking_time}+08:00`);
    if(!Number.isFinite(start.getTime()))throw new Error('Invalid reminder session date/time');
    const intro=new Date(start.getTime()+15*60_000),session=new Date(start.getTime()+30*60_000);
    const times=[start,intro,intro,session,session].map(date=>date.toLocaleTimeString('en-US',{
        timeZone:'Asia/Singapore',hour:'numeric',minute:'2-digit',hour12:true
    }).toLowerCase().replace(/\s/g,''));
    const hour=Number(start.toLocaleTimeString('en-GB',{timeZone:'Asia/Singapore',hour:'2-digit',hourCycle:'h23'}));
    const period=hour<12?0:hour<18?1:2;
    return [0,1].map(i=>[...times,(i===0?['morning','afternoon','evening']:['上午','下午','晚上'])[period]]);
}
function preview(booking){
    const values=parameters(booking);
    return definitions.slice(0,2).map((d,i)=>d.components[0].text.replace(/\{\{(\d+)\}\}/g,(_,n)=>values[i][Number(n)-1]));
}
function sequence(booking){
    const values=parameters(booking);
    return definitions.map((d,i)=>({messaging_product:'whatsapp',to:booking.customer_phone,type:'template',template:{
        name:d.name,language:{code:d.language},components:i===2
            ? [{type:'header',parameters:[{type:'document',document:{link:DIRECTIONS_PDF,filename:'Directions.pdf'}}]}]
            : [{type:'body',parameters:values[i].map(text=>({type:'text',text}))}]
    }}));
}
module.exports={definitions,preview,sequence,ADDRESS,DIRECTIONS_PDF};
