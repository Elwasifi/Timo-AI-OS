// M7-13c-2c-a (delta): casual Egyptian / MSA sentences that are NOT mission requests. Shared by the stress test and by the table
// printed in the review report. Several use a mission-list word (اعمل / نفذ / نظام / ثم / كمان / طبق / ولد / جهز / خطط) in its ordinary,
// non-task sense; the last group is longer than 8 words so the "short request" bonus does not mask a false positive.

export const CASUAL_SENTENCES: ReadonlyArray<readonly [group: string, text: string]> = [
  // food
  ['food', 'ايه احسن طبق كشري في وسط البلد'],
  ['food', 'عايز اعمل قهوة بالبندق النهارده'],
  ['food', 'هاكل فراخ مشوية مع رز وسلطة على الغدا'],
  ['food', 'طبق الملوخية بالارانب بقى احلى حاجة عند امي'],
  ['food', 'جهز الشاي يا محمد لحد ما اخلص'],
  // shopping
  ['shopping', 'محتاج اشتري جزمة جديدة بس الاسعار غالية اوي'],
  ['shopping', 'هل المحل ده بيقبل الفيزا ولا كاش بس'],
  ['shopping', 'جهز الفلوس علشان هنروح السوق بعد الضهر'],
  // weather
  ['weather', 'الجو النهارده حر جدا ومحتاج مروحة'],
  ['weather', 'هتمطر بكرة في اسكندرية ولا لا'],
  ['weather', 'البرد جه بدري السنة دي ثم رجع الشتا تاني'],
  // football
  ['football', 'الاهلي كسب امبارح والزمالك خسر بالتلاتة'],
  ['football', 'مين هيكسب الدوري السنة دي برأيك'],
  ['football', 'اللاعب ده ولد موهوب بجد'],
  // travel
  ['travel', 'ناوي اسافر الغردقة الاسبوع الجاي مع صحابي'],
  ['travel', 'خطط السفر بتاعتنا اتغيرت بسبب الطيران'],
  ['travel', 'ايه احسن وقت نروح فيه شرم الشيخ'],
  // family
  ['family', 'امي عملت كحك العيد وكلنا اتجمعنا عند تيتا'],
  ['family', 'الولد ده صغير اوي على المدرسة'],
  ['family', 'اخويا الكبير اتجوز امبارح وكمان اختي خطبت'],
  // health
  ['health', 'عندي صداع من الصبح ومش عارف اعمل ايه'],
  ['health', 'الدكتور قالي اشرب مية كتير وانام بدري'],
  ['health', 'ايه احسن حاجة للمغص'],
  // jokes
  ['joke', 'واحد صعيدي راح الدكتور قاله انا تعبان قاله روح ثم ارجع'],
  ['joke', 'مرة واحد بخيل اوي دخل مطعم وطلب طبق فاضي'],
  // short factual / opinion questions
  ['question', 'ايه عاصمة فرنسا'],
  ['question', 'هي القاهرة اكبر من اسكندرية ولا لا'],
  ['question', 'رايك ايه في الفيلم الجديد اللي نزل امبارح'],
  ['question', 'كام سعر الدولار النهارده'],
  ['question', 'مين اخترع الكهربا'],
  // mission-list words in their ordinary sense
  ['ordinary', 'البنزين نفذ ولازم نملا العربية'],
  ['ordinary', 'نفذ الصبر مني من الزحمة دي'],
  ['ordinary', 'نظام الدراسة عندكم ايه'],
  ['ordinary', 'نظام الاكل ده مش مناسب ليا'],
  ['ordinary', 'ثم رجعت البيت'],
  ['ordinary', 'هروح الجامعة ثم اروح النادي ثم اقابل صحابي'],
  ['ordinary', 'كمان شوية هنخرج نتمشى'],
  ['ordinary', 'وانا كمان عايز اسافر'],
  ['ordinary', 'بعد كده هكلمك'],
  ['ordinary', 'اعمل شاي لو سمحت'],
  ['ordinary', 'جهز الشنطة قبل ما ننزل'],
  ['ordinary', 'طبق الحلويات كان جميل'],
  ['ordinary', 'ولد وبنت لعبوا في الجنينة'],
  ['ordinary', 'خطط بابا للصيف كلها اتلغت'],
  ['ordinary', 'ما هي احسن مدرسة قريبة من هنا؟'],
  ['ordinary', 'انا بحب نظام الجيم الجديد'],
  // homographs and connectives in their everyday sense, in sentences long enough for the length bonus not to hide a flip
  ['homograph', 'ابني عنده امتحان بكرة وانا قلقان عليه اوي النهارده'],
  ['homograph', 'ابني بيحب الكورة وبيلعب كل يوم مع صحابه في النادي'],
  ['homograph', 'هنسافر طور سيناء الاسبوع الجاي مع العيلة كلها'],
  ['homograph', 'جهز نفسك علشان هنخرج بعد ساعة ونروح الفرح'],
  ['homograph', 'خطط الحكومة للسنة الجاية معلنة في الجرايد النهارده الصبح'],
  ['homograph', 'استنيتك عند المنصة في المحطة نص ساعة ومجيتش'],
  ['homograph', 'مدير الشركة طور مهارته بالقراءة والتدريب طول السنين اللي فاتت'],
  // longer sentences (more than 8 words): the length bonus no longer hides a false positive
  ['long', 'انا رحت السوق النهارده واشتريت خضار وفاكهة كمان واشتريت لبن وجبنة علشان العيال'],
  ['long', 'بعد ما خلصت الشغل رحت البيت ثم نمت ساعتين ثم صحيت اكلت وذاكرت شوية'],
  ['long', 'كل يوم بصحى بدري واعمل رياضة وبعدين اشرب قهوة واروح الشغل بالمترو'],
  ['long', 'نظام الدراسة في الجامعة عندنا صعب شوية بس الدكاترة كويسين ومتعاونين معانا'],
  ['long', 'صاحبي خطط للرحلة من شهر ونفذ كل حاجة لوحده وكان مبسوط جدا بالنتيجة'],
  ['long', 'المترو نظام نقل ممتاز في القاهرة بس الزحمة فيه صعبة الصبح'],
  ['long', 'عندي مهمة جديدة في الشغل بكرة ومش عارف هلاقي وقت اروح التمرين'],
  ['long', 'مديري اداني خطة عمل للاسبوع الجاي وانا مش مرتاح للمواعيد اللي فيها'],
  // the SAME word in its everyday sense, one list hit in a long sentence: the two-signal rule keeps these simple
  ['same-word', 'هو صمم يمشي لوحده رغم ان الدنيا ظلام'],
  ['same-word', 'بعد كده هنروح السينما ونتعشى برة ونرجع متأخر شوية'],
  ['same-word', 'بعد ذلك الحادثة الناس كلها بقت بتسوق بالراحة في الطريق'],
  ['same-word', 'واخيرا وصلنا البيت بعد ما الطريق كان زحمة جدا النهارده'],
  ['same-word', 'الطفل بيمشي خطوة بخطوة علشان لسه بيتعلم المشي في البيت'],
  ['same-word', 'هو انشئ حساب جديد على فيسبوك من يومين بس علشان يتابع اخبار الاهلي'],
  ['same-word', 'سير عمل الموظفين في الفرع ده مريح ومفيش ضغط خالص'],
  ['same-word', 'مديري عمل لنا اتمتة للمرتبات من فترة وبقت الامور احسن بكتير'],
];

// Remaining known limitation: ONE explicit mission noun used in its everyday sense in a sentence of 8 words or more. A noun is the strong
// signal on purpose (it is what makes the exact live message a mission), so these two still become missions. They are pinned here (the
// stress test asserts today's behaviour) so the day a better rule lands, the test tells whoever changes it to move them into CASUAL_SENTENCES.
export const KNOWN_SINGLE_SIGNAL_FALSE_POSITIVES: ReadonlyArray<readonly [group: string, text: string]> = [
  ['same-word', 'ميشن امبوسيبل فيلم حلو وانا اتفرجت عليه كذا مرة'],
  ['same-word', 'المهمة الاولى في الامتحان كانت سهلة والتانية صعبة شوية اوي'],
];
