const previous=require('./reminderDraft');
const definitions=structuredClone(previous.definitions);
definitions[0].name='tea_session_reminder_full_en_v4';
definitions[0].components[0].text=definitions[0].components[0].text.replace('Dear Tea Friends,','Dear Guests,');
definitions[1].name='tea_session_reminder_full_zh_v4';
definitions[1].components[0].text=`尊敬的茶友：

茶之相博物馆•观颐养性茶空间欢迎您明天莅临我们的茶空间！

🕰️ 为方便您预留充足的出行时间，以下是明天的活动流程：

{{1}} - {{2}}：签到
{{3}} - {{4}}：茶荟介绍及入座静待茶荟开始
{{5}}：茶荟正式开始

注意：为了让每位茶友都能享有最佳体验，茶荟开始后，我们可能无法安排迟到的茶友入场，敬请谅解。

温馨提醒：
●请穿宽松舒适、适合静坐的上衣和裤子。茶荟时间请穿袜子。

●请避免食用葱、姜、蒜、咖喱及其他辛辣食物，避免饮酒。活动前1小时请避免进食。

●茶荟可能流汗，若必要请自行携带更换的衣物。

●请避免使用香水。

明天{{6}}见！祝您今天过得愉快。`;
function sequence(booking){const payloads=previous.sequence(booking);for(let i=0;i<2;i++)payloads[i].template.name=definitions[i].name;return payloads;}
function preview(booking){const payloads=sequence(booking);return definitions.slice(0,2).map((d,i)=>d.components[0].text.replace(/\{\{(\d+)\}\}/g,(_,n)=>payloads[i].template.components[0].parameters[Number(n)-1].text));}
module.exports={definitions,sequence,preview,ADDRESS:previous.ADDRESS,DIRECTIONS_PDF:previous.DIRECTIONS_PDF};
