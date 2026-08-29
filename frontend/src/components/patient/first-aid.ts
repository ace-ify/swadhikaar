"use client";

// What to do while help is coming.
//
// EOS has a searchable first-aid hub with voice walkthroughs. A search box is the wrong
// shape for the ninety seconds after someone presses SOS: the person is frightened, may
// be holding a phone one-handed, and already told us what happened. So the guidance is
// selected from the incident type they reported and shows three or four steps, Hindi
// first.
//
// NOT clinical advice, and it does not pretend to be. Every card ends with the same
// line, because the honest instruction in an emergency is to keep the airway open and
// wait for people who are trained.

export type FirstAid = { hi: string; en: string }[];

const GUIDANCE: Record<string, FirstAid> = {
  "Road traffic accident": [
    { hi: "उन्हें हिलाएं नहीं — गर्दन और रीढ़ को सीधा रखें।", en: "Do not move them — keep the neck and spine still." },
    { hi: "खून बह रहा हो तो साफ कपड़े से दबाकर रखें।", en: "If bleeding, press firmly with a clean cloth." },
    { hi: "सड़क पर हों तो पीछे से आती गाड़ियों को रोकें।", en: "If on the road, stop oncoming traffic." },
    { hi: "उनसे बात करते रहें — वे सुन रहे हैं।", en: "Keep talking to them — they can hear you." },
  ],
  "Cardiac emergency": [
    { hi: "उन्हें बैठाएं, आगे झुकाकर आराम से। लिटाएं नहीं।", en: "Sit them up, leaning forward. Do not lay them flat." },
    { hi: "तंग कपड़े ढीले करें।", en: "Loosen tight clothing." },
    { hi: "उन्हें चलने या कुछ उठाने न दें।", en: "Do not let them walk or lift anything." },
    { hi: "अगर वे बेहोश हो जाएं और सांस न लें — छाती के बीच में तेज़ी से दबाएं।", en: "If they collapse and stop breathing, push hard and fast in the centre of the chest." },
  ],
  Breathlessness: [
    { hi: "उन्हें सीधा बैठाएं — लिटाएं नहीं।", en: "Sit them upright — do not lay them down." },
    { hi: "खिड़की खोलें, भीड़ हटाएं।", en: "Open a window, move people back." },
    { hi: "इनहेलर है तो अभी दें।", en: "If they have an inhaler, use it now." },
    { hi: "होंठ नीले पड़ने लगें तो हमें फिर बताएं।", en: "If their lips start turning blue, tell us again." },
  ],
  "Severe bleeding": [
    { hi: "साफ कपड़े से घाव पर ज़ोर से दबाएं और दबाए रखें।", en: "Press hard on the wound with a clean cloth and keep pressing." },
    { hi: "कपड़ा हटाकर देखें नहीं — ऊपर से और कपड़ा रखें।", en: "Do not lift the cloth to look — add more on top." },
    { hi: "हो सके तो घायल हिस्से को दिल से ऊपर उठाएं।", en: "If you can, raise the injured part above the heart." },
    { hi: "बांधने के लिए रस्सी या तार का इस्तेमाल न करें।", en: "Do not tie anything tight around the limb." },
  ],
  Fall: [
    { hi: "उन्हें उठाने की कोशिश न करें।", en: "Do not try to lift them up." },
    { hi: "जहां दर्द है वहां हाथ न लगाएं।", en: "Do not touch or straighten where it hurts." },
    { hi: "उन्हें गर्म रखें — ऊपर से कपड़ा डालें।", en: "Keep them warm — put a cloth over them." },
    { hi: "सिर पर चोट लगी हो तो उन्हें सोने न दें।", en: "If the head is hurt, do not let them sleep." },
  ],
  Emergency: [
    { hi: "उन्हें सुरक्षित जगह पर रखें और शांत रहें।", en: "Keep them somewhere safe and stay calm." },
    { hi: "उनसे बात करते रहें।", en: "Keep talking to them." },
    { hi: "कुछ खाने या पीने को न दें।", en: "Do not give anything to eat or drink." },
  ],
};

export function firstAidFor(incidentType: string): FirstAid {
  return GUIDANCE[incidentType] ?? GUIDANCE.Emergency;
}

// For the browsable version of the same guidance. EOS puts a search box on theirs; six
// entries do not need one, and a search box is a thing to fail at when you are shaking.
export const FIRST_AID_TOPICS: { type: string; hi: string; en: string }[] = [
  { type: "Road traffic accident", hi: "दुर्घटना", en: "Road accident" },
  { type: "Cardiac emergency", hi: "सीने में दर्द", en: "Chest pain" },
  { type: "Breathlessness", hi: "सांस लेने में तकलीफ", en: "Breathing trouble" },
  { type: "Severe bleeding", hi: "बहुत खून बह रहा है", en: "Heavy bleeding" },
  { type: "Fall", hi: "गिर गए / चोट", en: "Fall or injury" },
  { type: "Emergency", hi: "कुछ और", en: "Anything else" },
];
