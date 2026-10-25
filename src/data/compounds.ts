export interface CompoundPair {
  word1: string;
  word2: string;
  result: string;
  icon1: string;
  icon2: string;
  iconResult: string;
  pron: string;
}

export const COMPOUND_PAIRS: CompoundPair[] = [
  { word1:'pan',    word2:'cake',    result:'pancake',    icon1:'🍳', icon2:'🎂', iconResult:'🥞', pron:'PAN · cake' },
  { word1:'sun',    word2:'flower',  result:'sunflower',  icon1:'☀️', icon2:'🌸', iconResult:'🌻', pron:'SUN · flow · er' },
  { word1:'star',   word2:'fish',    result:'starfish',   icon1:'⭐', icon2:'🐠', iconResult:'🌟', pron:'STAR · fish' },
  { word1:'rain',   word2:'bow',     result:'rainbow',    icon1:'🌧️', icon2:'🎀', iconResult:'🌈', pron:'RAIN · bow' },
  { word1:'birth',  word2:'day',     result:'birthday',   icon1:'🎁', icon2:'📅', iconResult:'🎂', pron:'BIRTH · day' },
  { word1:'butter', word2:'fly',     result:'butterfly',  icon1:'🧈', icon2:'💨', iconResult:'🦋', pron:'BUT · ter · fly' },
  { word1:'base',   word2:'ball',    result:'baseball',   icon1:'🏟️', icon2:'⚾', iconResult:'⚾', pron:'BASE · ball' },
  { word1:'foot',   word2:'ball',    result:'football',   icon1:'👟', icon2:'🏈', iconResult:'⚽', pron:'FOOT · ball' },
  { word1:'snow',   word2:'ball',    result:'snowball',   icon1:'❄️', icon2:'⚪', iconResult:'☃️', pron:'SNOW · ball' },
  { word1:'water',  word2:'fall',    result:'waterfall',  icon1:'💧', icon2:'🌿', iconResult:'💦', pron:'WA · ter · fall' },
  { word1:'moon',   word2:'light',   result:'moonlight',  icon1:'🌙', icon2:'💡', iconResult:'🌕', pron:'MOON · light' },
  { word1:'fire',   word2:'place',   result:'fireplace',  icon1:'🔥', icon2:'🏠', iconResult:'🔥', pron:'FIRE · place' },
  { word1:'book',   word2:'shelf',   result:'bookshelf',  icon1:'📚', icon2:'🗂️', iconResult:'📖', pron:'BOOK · shelf' },
  { word1:'cup',    word2:'cake',    result:'cupcake',    icon1:'☕', icon2:'🎂', iconResult:'🧁', pron:'CUP · cake' },
  { word1:'sea',    word2:'shell',   result:'seashell',   icon1:'🌊', icon2:'🐚', iconResult:'🐚', pron:'SEA · shell' },
  { word1:'hand',   word2:'bag',     result:'handbag',    icon1:'✋', icon2:'🎒', iconResult:'👜', pron:'HAND · bag' },
  { word1:'door',   word2:'bell',    result:'doorbell',   icon1:'🚪', icon2:'🔔', iconResult:'🔔', pron:'DOOR · bell' },
  { word1:'eye',    word2:'ball',    result:'eyeball',    icon1:'👁️', icon2:'⚪', iconResult:'👀', pron:'EYE · ball' },
  { word1:'key',    word2:'board',   result:'keyboard',   icon1:'🔑', icon2:'📋', iconResult:'⌨️', pron:'KEY · board' },
  { word1:'note',   word2:'book',    result:'notebook',   icon1:'📝', icon2:'📚', iconResult:'📓', pron:'NOTE · book' },
  { word1:'play',   word2:'ground',  result:'playground', icon1:'🎮', icon2:'🌱', iconResult:'🛝', pron:'PLAY · ground' },
  { word1:'snow',   word2:'flake',   result:'snowflake',  icon1:'❄️', icon2:'✨', iconResult:'❄️', pron:'SNOW · flake' },
  { word1:'sun',    word2:'rise',    result:'sunrise',    icon1:'☀️', icon2:'🌄', iconResult:'🌅', pron:'SUN · rise' },
  { word1:'sun',    word2:'set',     result:'sunset',     icon1:'☀️', icon2:'🌇', iconResult:'🌆', pron:'SUN · set' },
  { word1:'tea',    word2:'pot',     result:'teapot',     icon1:'🍵', icon2:'🫙', iconResult:'🫖', pron:'TEA · pot' },
  { word1:'tooth',  word2:'brush',   result:'toothbrush', icon1:'🦷', icon2:'🖌️', iconResult:'🪥', pron:'TOOTH · brush' },
  { word1:'water',  word2:'melon',   result:'watermelon', icon1:'💧', icon2:'🍈', iconResult:'🍉', pron:'WA · ter · mel · on' },
  { word1:'week',   word2:'end',     result:'weekend',    icon1:'📅', icon2:'🎉', iconResult:'🥳', pron:'WEEK · end' },
  { word1:'light',  word2:'house',   result:'lighthouse', icon1:'💡', icon2:'🏠', iconResult:'🗼', pron:'LIGHT · house' },
  { word1:'news',   word2:'paper',   result:'newspaper',  icon1:'📢', icon2:'📄', iconResult:'📰', pron:'NEWS · pa · per' },
];

const SCHEMES = [
  { bg: 0xD0E8FF, ac: 0x1A6DB5 }, // sky blue
  { bg: 0xFFD0E8, ac: 0xC4186E }, // rose pink
  { bg: 0xD0FFE8, ac: 0x1A7A4A }, // mint green
  { bg: 0xFFEED0, ac: 0xB86000 }, // amber orange
  { bg: 0xEED0FF, ac: 0x7730B0 }, // lavender
  { bg: 0xFFFBD0, ac: 0xAA8800 }, // butter yellow
  { bg: 0xD0F0FF, ac: 0x0070BB }, // ice blue
  { bg: 0xFFD4D0, ac: 0xBB2222 }, // coral red
];

export function cardScheme(word: string) {
  return SCHEMES[word.charCodeAt(0) % SCHEMES.length];
}

export function pickRoundPairs(count: number): CompoundPair[] {
  return [...COMPOUND_PAIRS].sort(() => Math.random() - 0.5).slice(0, count);
}
