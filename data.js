/* Программа тренировок — единственный файл, который нужно править,
   если меняешь упражнения, подходы или время отдыха.

   name     — название упражнения
   sets     — число рабочих подходов
   reps     — диапазон повторов
   rest     — отдых после подхода, секунды (0 = сразу вторая часть суперсета)
   superset — общая метка у упражнений одной связки, иначе null
*/

const PROGRAM = {
  mon: {
    title: "Понедельник",
    subtitle: "Верх A · акцент грудь",
    exercises: [
      { name: "Жим гантелей на наклонной скамье 30°",                sets: 3, reps: "6–10",  rest: 150, superset: null },
      { name: "Подтягивания с весом / вертикальная тяга нейтральным", sets: 3, reps: "8–12",  rest: 150, superset: null },
      { name: "Жим в хаммере (горизонтальный)",                       sets: 3, reps: "8–12",  rest: 120, superset: null },
      { name: "Тяга горизонтального блока узким хватом",              sets: 3, reps: "10–12", rest: 120, superset: null },
      { name: "Махи в стороны в кроссовере (одной рукой)",            sets: 3, reps: "12–20", rest:  60, superset: null },
      { name: "Подъём гантелей на бицепс на наклонной",               sets: 3, reps: "8–12",  rest:   0, superset: "a" },
      { name: "Разгибания на трицепс из-за головы на блоке",          sets: 2, reps: "10–12", rest:  90, superset: "a" }
    ]
  },

  wed: {
    title: "Среда",
    subtitle: "Низ + плечи",
    exercises: [
      { name: "Присед со штангой / гакк-присед",           sets: 3, reps: "6–10",  rest: 180, superset: null },
      { name: "Румынская тяга",                            sets: 3, reps: "8–12",  rest: 150, superset: null },
      { name: "Жим ногами",                                sets: 3, reps: "10–15", rest: 120, superset: null },
      { name: "Сгибания ног сидя",                         sets: 3, reps: "10–12", rest:  90, superset: null },
      { name: "Подъёмы на носки стоя",                     sets: 3, reps: "8–15",  rest:  60, superset: null },
      { name: "Жим сидя (гантели или тренажёр)",           sets: 3, reps: "8–12",  rest: 120, superset: null },
      { name: "Обратная бабочка (задняя дельта)",          sets: 3, reps: "15–20", rest:   0, superset: "a" },
      { name: "Махи в стороны с гантелями",                sets: 2, reps: "12–20", rest:  90, superset: "a" }
    ]
  },

  fri: {
    title: "Пятница",
    subtitle: "Верх B · акцент спина",
    exercises: [
      { name: "Тяга штанги в наклоне / Т-гриф",                    sets: 3, reps: "8–12",  rest: 150, superset: null },
      { name: "Жим штанги лёжа",                                   sets: 3, reps: "6–10",  rest: 180, superset: null },
      { name: "Вертикальная тяга широким хватом",                  sets: 3, reps: "10–12", rest: 120, superset: null },
      { name: "Жим в наклонном тренажёре / брусья с наклоном",     sets: 3, reps: "8–12",  rest: 120, superset: null },
      { name: "Махи в стороны с гантелями",                        sets: 3, reps: "12–20", rest:   0, superset: "a" },
      { name: "Тяга к лицу (face pull)",                           sets: 2, reps: "15–20", rest:  90, superset: "a" },
      { name: "Молот на бицепс",                                   sets: 3, reps: "8–12",  rest:   0, superset: "b" },
      { name: "Разгибания на трицепс на блоке вниз",               sets: 3, reps: "10–15", rest:  90, superset: "b" },
      { name: "Подъёмы на носки сидя",                             sets: 2, reps: "12–20", rest:  60, superset: null }
    ]
  }
};

/* Порядок вкладок и то, какой день открывается в какой день недели.
   Индексы getDay(): 0=вс, 1=пн … 6=сб */
const DAY_ORDER = ["mon", "wed", "fri"];
const WEEKDAY_MAP = { 1:"mon", 2:"mon", 3:"wed", 4:"wed", 5:"fri", 6:"fri", 0:"fri" };
