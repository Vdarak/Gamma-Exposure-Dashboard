"use client"

import { useEffect, useState } from "react"

interface Shloka {
  sanskrit: string
  translation: string
}

const SHLOKAS: Shloka[] = [
  {
    sanskrit: "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥",
    translation: "You have a right to perform your prescribed duty, but you are not entitled to the fruits of your actions. Never consider yourself to be the cause of the results of your activities, nor be attached to inaction."
  },
  {
    sanskrit: "योगस्थः कुरु कर्माणि सङ्गं त्यक्त्वा धनञ्जय ।\nसिद्ध्यसिद्ध्योः समो भूत्वा समत्वं योग उच्यते ॥",
    translation: "Be steadfast in yoga, O Arjuna. Perform your duty and abandon all attachment to success or failure. Such equanimity of mind is called yoga."
  },
  {
    sanskrit: "ध्यायतो विषयान्पुंसः सङ्गस्तेषूपजायते ।\nसङ्गात्सञ्जायते कामः कामात्क्रोधोऽभिजायते ॥",
    translation: "While contemplating the objects of the senses, a person develops attachment for them, and from such attachment lust develops, and from lust anger arises."
  },
  {
    sanskrit: "क्रोधाद्भवति सम्मोहः सम्मोहात्स्मृतिविभ्रमः ।\nस्मृतिभ्रंशाद्बुद्धिनाशो बुद्धिनाशात्प्रणश्यति ॥",
    translation: "From anger arises complete delusion, and from delusion bewilderment of memory. When memory is bewildered, intellect is lost, and when intellect is lost, one is ruined."
  },
  {
    sanskrit: "दुःखेष्वनुद्विग्नमनाः सुखेषु विगतस्पृहः ।\nवीतरागभयक्रोधः स्थितधीर्मुनिरुच्यते ॥",
    translation: "One whose mind remains undisturbed amidst misery, who does not crave pleasure, and who is free from attachment, fear, and anger, is called a sage of steady wisdom."
  },
  {
    sanskrit: "मात्रास्पर्शास्तु कौन्तेय शीतोष्णसुखदुःखदाः ।\nआगमापायिनोऽनित्यास्तांस्तितिक्षस्व भारत ॥",
    translation: "The contact between the senses and their objects give rise to sensations of heat and cold, pleasure and pain. They come and go and are temporary. Bear them patiently."
  },
  {
    sanskrit: "यं हि न व्यथयन्त्येते पुरुषं पुरुषर्षभ ।\nसमदुःखसुखं धीरं सोऽमृतत्वाय कल्पते ॥",
    translation: "O noblest among men, the person who is not distressed by these sensory fluctuations, remaining equal in pleasure and pain, is fit for liberation."
  },
  {
    sanskrit: "सुखदुःखे समे कृत्वा लाभालाभौ जयाजयौ ।\nततो युद्धाय युज्यस्व नैवं पापमवाप्स्यसि ॥",
    translation: "Fight for the sake of duty, treating alike pleasure and pain, gain and loss, victory and defeat. By doing so, you shall never incur sin."
  },
  {
    sanskrit: "बुद्धियुक्तो जहातीह उभे सुकृतदुष्कृते ।\nतस्माद्योगाय युज्यस्व योगः कर्मसु कौशलम् ॥",
    translation: "One who is united in consciousness discards both good and evil deeds in this life. Therefore, strive for yoga; yoga is skill in action."
  },
  {
    sanskrit: "प्रजहाति यदा कामान्सर्वान्पार्थ मनोगतान् ।\nआत्मन्येवात्मना तुष्टः स्थितप्रज्ञस्तदोच्यते ॥",
    translation: "When one discards all desires of the mind, O Partha, and is satisfied in the self by the self alone, then one is said to be of steady wisdom."
  },
  {
    sanskrit: "तस्मादसक्तः सततम् कार्यं कर्म समाचर ।\nअसक्तो ह्याचरन्कर्म परमाप्नोति पूरुषः ॥",
    translation: "Therefore, without attachment, constantly perform the work that ought to be done, for by performing action without attachment, man reaches the Supreme."
  },
  {
    sanskrit: "श्रेयान्स्वधर्मो विगुणः परधर्मात्स्वनुष्ठितात् ।\nस्वधर्मे निधनं श्रेयः परधर्मो भयावहः ॥",
    translation: "It is far better to perform one’s own duty, even if imperfectly, than to perform another’s duty perfectly. Destruction in the course of performing one’s duty is better than engaging in another’s duty, which is dangerous."
  },
  {
    sanskrit: "इन्द्रियाणि पराण्याहुरिन्द्रियेभ्यः परं मनः ।\nमनसस्तु परा बुद्धिर्यो बुद्धेः परतस्तु सः ॥",
    translation: "The senses are said to be superior to the physical body; the mind is superior to the senses; the intellect is superior to the mind; and the soul is even superior to the intellect."
  },
  {
    sanskrit: "त्यक्त्वा कर्मफलासङ्गं नित्यतृप्तो निराश्रयः ।\nकर्मण्यभिप्रवृत्तोऽपि नैव किञ्चित्करोति सः ॥",
    translation: "Abandoning attachment to the fruits of action, ever satisfied and independent, even though fully engaged in activity, one performs no action at all."
  },
  {
    sanskrit: "यदृच्छालाभसन्तुष्टो द्वन्द्वातीतो विमत्सरः ।\nसमः सिद्धावसिद्दौ च कृत्वापि न निबध्यते ॥",
    translation: "He who is satisfied with whatever comes by its own accord, who is free from duality and jealousy, and who is equanimous in success and failure, is not bound even when performing actions."
  },
  {
    sanskrit: "न हि ज्ञानेन सदृशं पवित्रमिह विद्यते ।\nतत्स्वयं योगसंसिद्धः कालेनात्मनि विन्दति ॥",
    translation: "In this world, there is nothing as purifying as transcendental knowledge. One who has become accomplished in yoga finds this knowledge within oneself in due course of time."
  },
  {
    sanskrit: "विद्याविनयसम्पन्ने ब्राह्मणे गवि हस्तिनि ।\nशुनि चैव श्वपाके च पण्डिताः समदर्शिनः ॥",
    translation: "The humble sages, by virtue of true knowledge, see with an equal eye a wise and gentle priest, a cow, an elephant, a dog, and a dog-eater."
  },
  {
    sanskrit: "इहैव तैर्जितः सर्गो येषां साम्ये स्थितं मनः ।\nनिर्दोषं हि समं ब्रह्म तस्माद्ब्रह्मणि ते स्थिताः ॥",
    translation: "Those whose minds are established in equality and equanimity have already conquered the conditions of birth and death in this life. They are flawless like Brahman, and thus they are established in Brahman."
  },
  {
    sanskrit: "न प्रहृष्येत्प्रियं प्राप्य नोद्विजेत्प्राप्य चाप्रियम् ।\nस्थिरबुद्धिरसम्मूढो ब्रह्मविद्ब्रह्मणि स्थितः ॥",
    translation: "One who neither rejoices upon achieving something pleasant nor laments upon obtaining something unpleasant, who is self-intelligent, unbewildered, and knows the Supreme, is already situated in the Divine."
  },
  {
    sanskrit: "उद्धरेदात्मनात्मानं नात्मानमवसादयेत् ।\nआत्मैव ह्यात्मनो बन्धुरात्मैव रिपुरात्मनः ॥",
    translation: "Let a man lift himself by his own Self, let him not degrade himself. For the Self is the friend of the self, and the Self is the enemy of the self."
  },
  {
    sanskrit: "बन्धुरात्मात्मनस्तस्य येनात्मैवात्मना जितः ।\nअनात्मनस्तु शत्रुत्वे वर्तेतात्मैव शत्रुवत् ॥",
    translation: "For those who have conquered the mind, the mind is their friend. For those who have failed to do so, the mind remains their greatest enemy."
  },
  {
    sanskrit: "यथा दीपो निवातस्थो नेङ्गते सोपमा स्मृता ।\nयोगिनो यतचित्तस्य युञ्जतो योगमात्मनः ॥",
    translation: "As a lamp in a windless place does not flicker, so is the disciplined mind of a yogi practicing meditation on the Self."
  },
  {
    sanskrit: "यं लब्ध्वा चापरं लाभं मन्यते नाधिकं ततः ।\nयस्मिन्स्थितो न दुःखेन गुरुणापि विचाल्यते ॥",
    translation: "Upon attaining this state, one realizes there is no greater gain. Established in this, one is not shaken even by the heaviest sorrow."
  },
  {
    sanskrit: "शनैः शनैरुपरमेद्बुद्ध्या धृतिगृहीतया ।\nआत्मसंस्थं मनः कृत्वा न किञ्चिदपि चिन्तयेत् ॥",
    translation: "Gradually, step by step, one should attain quietude by means of the intellect controlled by conviction, and fixing the mind on the Self alone, think of nothing else."
  },
  {
    sanskrit: "यतो यतो निश्चरति मनश्चञ्चलमस्थिरम् ।\nततस्ततो नियम्यैतदात्मन्येव वशं नयेत् ॥",
    translation: "Wherever the restless and unsteady mind wanders, one should withdraw it and bring it back under the control of the Self."
  },
  {
    sanskrit: "असंशयं महाबाहो मनो दुर्निग्रहं चलम् ।\nअभ्यासेन तु कौन्तेय वैराग्येण च गृह्यते ॥",
    translation: "Undoubtedly, O mighty-armed son of Kunti, the mind is restless and difficult to curb, but it can be conquered by constant practice and detachment."
  },
  {
    sanskrit: "अनन्याश्चिन्तयन्तो मां ये जनाः पर्युपासते ।\nतेषां नित्याभियुक्तानां योगक्षेमं वहाम्यहम् ॥",
    translation: "For those who always worship Me with exclusive devotion, meditating on My transcendental form, to them I carry what they lack and preserve what they have."
  },
  {
    sanskrit: "यत्करोषि यदश्नासि यज्जुहोषि ददासि यत् ।\nयत्तपस्यसि कौन्तेय तत्कुरुष्व मदर्पणम् ॥",
    translation: "Whatever you do, whatever you eat, whatever you offer or give away, and whatever austerities you perform—do that, O son of Kunti, as an offering unto Me."
  },
  {
    sanskrit: "अद्वेष्टा सर्वभूतानां मैत्रः करुण एव च ।\nनिर्ममो निरहङ्कारः समदुःखसुखः क्षमी ॥",
    translation: "One who is not envious but is a kind friend to all living entities, who does not think himself a proprietor and is free from false ego, who is equal in both happiness and distress, and who is forgiving..."
  },
  {
    sanskrit: "सन्तुष्टः सततं योगी यतात्मा दृढनिश्चयः ।\nमय्यर्पितमनोबुद्धिर्यो मद्भक्तः स मे प्रियः ॥",
    translation: "...who is always satisfied, self-controlled, and engaged in devotion with determination, having his mind and intelligence fixed on Me—such a devotee of Mine is very dear to Me."
  },
  {
    sanskrit: "यस्मान्नोद्विजते लोको लोकान्नोद्विजते च यः ।\nहर्षामर्षभयोद्वेगैर्मुक्तो यः स च मे प्रियः ॥",
    translation: "He by whom no one is put into difficulty and who is not disturbed by anyone, who is liberated from excessive joy, anger, fear, and anxiety, is very dear to Me."
  },
  {
    sanskrit: "इन्द्रियार्थेषु वैराग्यमनहङ्कार एव च ।\nजन्ममृत्युजराव्याधिदुःखदोषानुदर्शनम् ॥",
    translation: "Dispassion towards the objects of the senses, absence of egotism, and reflection on the evils of birth, death, old age, disease, and pain..."
  },
  {
    sanskrit: "अध्यात्मज्ञाननित्यत्वं तत्त्वज्ञानार्थदर्शनम् ।\nएतज्ज्ञानमिति प्रोक्तमज्ञानं यदतोऽन्यथा ॥",
    translation: "Constancy in self-knowledge, perception of the goal of truth—this is declared to be knowledge, and everything else is ignorance."
  },
  {
    sanskrit: "समदुःखसुखः स्वस्थः समलोष्टाश्मकाञ्चनः ।\nतुल्यप्रियाप्रियो धीरस्तुल्यनिन्दात्मसंस्तुतिः ॥",
    translation: "He who regards pain and pleasure alike, who dwells in his own self, who looks upon a clod, a stone, and gold with an equal eye, who is patient amidst the agreeable and disagreeable, and who is stable in censure and praise..."
  },
  {
    sanskrit: "तुल्यमानावमानयोस्तुल्यो मित्रारिपक्षयोः ।\nसर्वारम्भपरित्यागी गुणातीतः स उच्यते ॥",
    translation: "...who is the same in honor and dishonor, who is equal to friend and foe, and who has renounced all possessive undertakings—he is said to have risen above the modes of nature."
  },
  {
    sanskrit: "त्रिविधं नरकस्येदं द्वारं नाशनमात्मनः ।\nकामः क्रोधस्तथा लोभस्तस्मादेतत्त्रयं त्यजेत् ॥",
    translation: "There are three gates leading to this self-destruction: lust, anger, and greed. Therefore, one must abandon these three."
  },
  {
    sanskrit: "मुक्तसङ्गोऽनहंवादी धृत्युत्साहसमन्वितः ।\nसिद्ध्यसिद्ध्योर्निर्विकारः कर्ता सात्त्विक उच्यते ॥",
    translation: "An agent who is free from attachment, free from egotism, endowed with resolve and enthusiasm, and unperturbed by success or failure is said to be in the mode of goodness."
  },
  {
    sanskrit: "अहङ्कारं बलं दर्पं कामं क्रोधं परिग्रहम् ।\nविमुच्य निर्ममः शान्तो ब्रह्मभूयाय कल्पते ॥",
    translation: "Having cast aside egotism, violence, arrogance, desire, anger, and covetousness, being selfless and peaceful, one is fit for attaining Brahman."
  },
  {
    sanskrit: "ईश्वरः सर्वभूतानां हृद्देशेऽर्जुन तिष्ठति ।\nभ्रामयन्सर्वभूतानि यन्त्रारूढानि मायया ॥",
    translation: "The Supreme Lord dwells in the hearts of all living beings, O Arjuna, directing their wanderings by His external energy, as if they were seated on a machine."
  },
  {
    sanskrit: "सर्वधर्मान्परित्यज्य मामेकं शरणं व्रज ।\nअहं त्वां सर्वपापेभ्यो मोक्षयिष्यामि मा शुचः ॥",
    translation: "Abandon all varieties of duties and simply surrender unto Me. I shall deliver you from all sinful reactions. Do not fear."
  },
  {
    sanskrit: "अशोच्यानन्वशोचस्त्वं प्रज्ञावादांश्च भाषसे ।\nगतासूनगतासूंश्च नानुशोचन्ति पण्डिताः ॥",
    translation: "While speaking learned words, you are mourning for what is not worthy of grief. The wise lament neither for the living nor for the dead."
  },
  {
    sanskrit: "न त्वेवाहं जातु नासं न त्वं नेमे जनाधिपाः ।\nन चैव न भविष्यामः सर्वे वयमतः परम् ॥",
    translation: "Never was there a time when I did not exist, nor you, nor all these kings; nor in the future shall any of us cease to be."
  },
  {
    sanskrit: "देहिनोऽस्मिन्यथा देहे कौमारं यौवनं जरा ।\nतथा देहान्तरप्राप्तिर्धीरस्तत्र न मुह्यती ॥",
    translation: "As the embodied soul continuously passes, in this body, from boyhood to youth to old age, the soul similarly passes into another body at death. A sober person is not bewildered by such a change."
  },
  {
    sanskrit: "न जायते म्रियते वा कदाचि\nन्नायं भूत्वा भविता वा न भूयः ।\nअजो नित्यः शाश्वतोऽयं पुराणो\nन हन्यते हन्यमाने शरीरे ॥",
    translation: "For the soul there is never birth nor death at any time. He has not come into being, does not come into being, and will not come into being. He is unborn, eternal, ever-existing, and primeval. He is not slain when the body is slain."
  },
  {
    sanskrit: "वासांसि जीर्णानि यथा विहाय\nनवानि गृह्णाति नरोऽपराणि ।\nतथा शरीराणि विहाय जीर्णान्य\nन्यानि संयाति नवानि देही ॥",
    translation: "As a person puts on new garments, giving up old ones, the soul similarly accepts new material bodies, giving up the old and useless ones."
  },
  {
    sanskrit: "जातस्य हि ध्रुवो मृत्युर्ध्रुवं जन्म मृतस्य च ।\nतस्मादपरिहार्येऽर्थे न त्वं शोचितुमर्हसि ॥",
    translation: "One who has taken his birth is sure to die, and after death one is sure to take birth again. Therefore, in the unavoidable discharge of your duty, you should not lament."
  },
  {
    sanskrit: "त्रैगुण्यविषया वेदा निस्त्रैगुण्यो भवार्जुन ।\nनिर्द्वन्द्वो नित्यसत्त्वस्थो निर्योगक्षेम आत्मवान् ॥",
    translation: "The Vedas deal mainly with the subject of the three modes of material nature. Rise above these modes, O Arjuna. Be free from all dualities and from all anxieties for gain and safety, and be established in the Self."
  },
  {
    sanskrit: "रागद्वेषवियुक्तैस्तु विषयानिन्द्रियैश्चरन् ।\nआत्मवश्यैर्विधेयात्मा प्रसादमधिगच्छति ॥",
    translation: "But a disciplined person, moving among objects with senses free from attachment and aversion and under self-control, attains peaceful serenity."
  },
  {
    sanskrit: "प्रसादे सर्वदुःखानां हानिरस्योपजायते ।\nप्रसन्नचेतसो ह्याशु बुद्धिः पर्यवतिष्ठति ॥",
    translation: "In that peaceful serenity, all one’s miseries are destroyed. Indeed, the intellect of such a person of serene mind soon becomes completely stable."
  },
  {
    sanskrit: "नास्ति बुद्धिरयुक्तस्य न चायुक्तस्य भावना ।\nन चाभावयतः शान्तिरशान्तस्य कुतः सुखम् ॥",
    translation: "One who is not connected with the Divine has neither disciplined intellect nor steady contemplation. For one who does not contemplate there is no peace, and how can there be happiness without peace?"
  },
  {
    sanskrit: "आपूर्यमाणमचलप्रतिष्ठं\nसमुद्रमापः प्रविशन्ति यद्वत् ।\nतद्वत्कामा यं प्रविशन्ति सर्वे\nस शान्तिमाप्नोति न कामकामी ॥",
    translation: "A person who is not disturbed by the incessant flow of desires—that enter like rivers into the ocean, which is ever being filled but remains always still—can alone achieve peace, and not the one who strives to satisfy such desires."
  },
  {
    sanskrit: "विहाय कामान्यः सर्वान्पुमांश्चरति निःस्पृहः ।\nनिर्ममो निरहङ्कारः स शान्तिमाधिगच्छति ॥",
    translation: "A person who has given up all desires for sense gratification, who lives free from desires, who has given up all sense of proprietorship and is devoid of false ego—he alone attains real peace."
  },
  {
    sanskrit: "नियतं कुरु कर्म त्वं कर्म ज्यायो ह्यकर्मणः ।\nशरीरयात्रापि च ते न प्रसिद्धयेदकर्मणः ॥",
    translation: "Perform your prescribed duties, for action is better than inaction. Even the maintenance of your body would not be possible without action."
  },
  {
    sanskrit: "यज्ञार्थात्कर्मणोऽन्यत्र लोकोऽयं कर्मबन्धनः ।\nतदर्थं कर्म कौन्तेय मुक्तसङ्गः समाचर ॥",
    translation: "Work must be done as a sacrifice, otherwise it causes bondage in this material world. Therefore, O son of Kunti, perform your duties for His satisfaction, and in that way you will remain free from attachment."
  },
  {
    sanskrit: "यद्यदाचरति श्रेष्ठस्तत्तदेवेतरो जनः ।\nस यत्प्रमाणं कुरुते लोकस्तदनुवर्तते ॥",
    translation: "Whatever action a great man performs, common men follow. And whatever standards he sets by his exemplary acts, all the world pursues."
  }
]

export function GitaQuote() {
  const [index, setIndex] = useState(0)
  const [fade, setFade] = useState(true)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    // Select a random index on mount
    setIndex(Math.floor(Math.random() * SHLOKAS.length))
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % SHLOKAS.length)
        setFade(true)
      }, 500) // matches fade-out transition duration
    }, 180000) // cycle every 3 minutes (180,000 ms)

    return () => clearInterval(interval)
  }, [])

  const current = SHLOKAS[index]

  if (!current) return null

  return (
    <div
      className="max-w-4xl mx-auto w-full text-center py-1 select-none cursor-help"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`relative h-6 flex items-center justify-center transition-opacity duration-500 ${fade ? 'opacity-80 hover:opacity-100' : 'opacity-0'}`}>
        {/* Translation (Visible by default, fades out on hover) */}
        <p className={`absolute text-[10px] md:text-[11px] text-[#fff] font-mono whitespace-nowrap overflow-hidden text-ellipsis max-w-full px-4 transition-all duration-300 ${hovered ? 'opacity-0 scale-[0.98] pointer-events-none' : 'opacity-100 scale-100'
          }`}>
          {current.translation}
        </p>

        {/* Sanskrit Shloka (Faded out by default, fades in on hover) */}
        <p className={`absolute text-[10px] md:text-[11px] text-[#FFA726]/85 font-mono whitespace-nowrap overflow-hidden text-ellipsis max-w-full px-4 transition-all duration-300 ${hovered ? 'opacity-100 scale-100' : 'opacity-0 scale-[1.02] pointer-events-none'
          }`}>
          {current.sanskrit.replace(/\n/g, '  ')}
        </p>
      </div>
    </div>
  )
}
