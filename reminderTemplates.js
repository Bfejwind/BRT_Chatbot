const ADDRESS = 'RRoyce Building, 65 Mohamed Sultan Rd, Level 3, Singapore 239003';
const DIRECTIONS_PDF = 'https://ixjmzksmazysazlyoxne.supabase.co/storage/v1/object/public/chatbot-images/Getting%20to%20the%20RROYCE%20Building.pdf.pdf';
const english = `Dear Guest,

Authentic Tea Essence Museum•Guanyiyangxing Tea Space is truly looking forward to welcoming you to our tea space tomorrow!

🕰️ To help you buffer your time tomorrow, here is a quick look at our timeline:

{{1}} - {{2}}: Welcome & Registration
{{3}} - {{4}}: Intro & Seating starts promptly
{{5}}: Session begins

To give every participant the best experience, we kindly ask that you arrive by {{6}}.
Unfortunately, we may not be able to admit late arrivals once the session is underway.

Gentle reminder:
●Wear socks and loose, comfortable clothing for sitting.
●Avoid onion, ginger, garlic, curry, and other spicy foods.
●Refrain from using heavy perfumes.
●Avoid heavy meals 1 hour prior.
See you tomorrow {{7}}! Have a lovely day ahead.`;
const chinese = `尊敬的来宾：

茶之相博物馆•观颐养性茶空间满怀期待，欢迎您明天莅临我们的茶空间！

🕰️ 为方便您预留充足的出行时间，以下是明天的活动流程：

{{1}} - {{2}}：欢迎与签到
{{3}} - {{4}}：活动介绍与入座，准时开始
{{5}}：茶会正式开始

为了让每位来宾都能享有最佳体验，敬请您于{{6}}前抵达。
活动开始后，我们可能无法安排迟到的来宾入场，敬请谅解。

温馨提醒：
●请穿袜子及宽松舒适、适合静坐的衣物。
●请避免食用葱、姜、蒜、咖喱及其他辛辣食物。
●请避免使用浓烈的香水。
●活动前1小时请避免大量进食。
明天{{7}}见！祝您今天过得愉快。`;
function bodyDefinition(name, language, text, samples) {
    return { name, language, category:'UTILITY', components:[{
        type:'BODY', text, example:{body_text:[samples]}
    }] };
}
const definitions = [
    bodyDefinition('tea_session_reminder_full_en_v2','en',english,
        ['4:00 PM','4:15 PM','4:15 PM','4:30 PM','4:30 PM','4:30 PM','afternoon']),
    bodyDefinition('tea_session_reminder_full_zh_v2','zh_CN',chinese,
        ['下午4:00','下午4:15','下午4:15','下午4:30','下午4:30','下午4:30','下午']),
    { name:'tea_session_directions_v2',language:'en',category:'UTILITY',components:[
        {type:'HEADER',format:'DOCUMENT',example:{header_handle:[DIRECTIONS_PDF]}},
        {type:'BODY',text:`Directions for your booked tea session / 茶会交通指南\n\n${ADDRESS}`}
    ] }
];
function reminderSequence(booking) {
    const start = new Date(`${booking.booking_date}T${booking.booking_time}+08:00`);
    if (!Number.isFinite(start.getTime())) throw new Error('Invalid reminder session date/time');
    const intro = new Date(start.getTime()+15*60_000), session = new Date(start.getTime()+30*60_000);
    const dates=[start,intro,intro,session,session,session];
    const hour=Number(start.toLocaleTimeString('en-GB',{timeZone:'Asia/Singapore',hour:'2-digit',hourCycle:'h23'}));
    const period=hour<12?0:hour<18?1:2;
    const periods=[['morning','afternoon','evening'],['上午','下午','晚上']];
    return definitions.map((definition,i)=>({
        messaging_product:'whatsapp',to:booking.customer_phone,type:'template',
        template:{name:definition.name,language:{code:definition.language},components:i===2
            ? [{type:'header',parameters:[{type:'document',document:{link:DIRECTIONS_PDF,filename:'Directions.pdf'}}]}]
            : [{type:'body',parameters:[...dates.map(date=>date.toLocaleTimeString(i===0?'en-US':'zh-CN',{
                timeZone:'Asia/Singapore',hour:'numeric',minute:'2-digit',hour12:true
            })),periods[i][period]].map(text=>({type:'text',text}))}]
        }
    }));
}
module.exports={ADDRESS,DIRECTIONS_PDF,definitions,reminderSequence};
