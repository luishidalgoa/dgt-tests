"""
Datos del clasificador SigLIP: LABELS, LABEL_NEGATIVES, NEG_WEIGHT.

Por que viven aqui (y no en classify_siglip.py):
  - Permite que clasificadores alternativos (p.ej. classify_hf.py via HF
    Inference API) importen las mismas etiquetas sin necesidad de cargar
    torch/transformers en local.
  - Es datos puros, no codigo — separarlos de la logica de clasificacion
    reduce el archivo principal de 2200 a 1300 lineas.

Para anadir/modificar etiquetas: edita ESTE archivo. classify_siglip.py
y classify_hf.py los importan automaticamente.
"""


# ── Vocabulario de etiquetas ────────────────────────────────────────────
# Cada tupla: (id_para_json, [lista_de_prompts_en_ingles]).
#
# Por qué ENSEMBLE de prompts en lugar de uno solo:
# Técnica estándar de zero-shot CLIP/SigLIP. Codificamos varios prompts
# por label y promediamos los embeddings → representación más robusta,
# 5-10% mejor accuracy. El primer intento usaba un solo prompt estilo
# "a photograph of X" — las imágenes DGT son ilustraciones, no fotos
# modernas, así que pegaban mal. Ahora cada label tiene 3 templates:
#   1. uno genérico
#   2. uno específico al dominio ("driving theory test image")
#   3. uno descriptivo del contenido visual concreto
#
# Los prompts van en inglés (SigLIP se entrenó casi todo en inglés).
LABELS: list[tuple[str, list[str]]] = [
    # ── Tipo de escena ─────────────────────────────────────────────
    ("urban_street", [
        "a dense urban street scene with multiple buildings tall facades commercial signs and city traffic on both sides",
        "a city street in a Spanish town with continuous building facades sidewalks street furniture and parked cars along the curb",
        "a downtown road environment with apartment blocks shops urban storefronts pedestrian sidewalks and multiple lanes of traffic",
    ]),
    ("rural_road", [
        "a rural countryside road",
        "a driving theory test image of a country road through fields",
        "an isolated rural road with no buildings around",
    ]),
    ("highway", [
        "a multi-lane highway with traffic",
        "an illustration of a motorway with multiple lanes",
        "a freeway viewed from a driver perspective in a driving test",
    ]),
    ("divided_highway", [
        "a wide road with a central median divider and guardrails along both sides separating two directions",
        "a highway with two lanes in each direction separated by a concrete barrier or guardrail median",
        "a divided road with a separator in the middle and safety barriers along the sides",
    ]),
    ("single_lane_road", [
        "a single lane road with no traffic separation or dividers between opposing directions",
        "a road with one lane in each direction and no median divider or central barrier",
        "a simple two-way road with a single lane for travel in either direction without separation",
    ]),
    ("road_works", [
        "a road partially blocked by orange and white traffic cones and construction barriers",
        "a street section closed or narrowed due to road works with cones barriers and warning signs",
        "a city road with a work zone blockade cones and construction workers or machinery present",
    ]),
    ("tunnel", [
        "a road tunnel",
        "an illustration of cars driving through a tunnel",
        "the interior of a road tunnel viewed from a vehicle",
    ]),
    ("tunnel_entrance", [
        "a road leading towards a tunnel entrance portal with warning signs on both sides",
        "a highway approaching a tunnel opening with multiple lanes and safety barriers before the entrance",
        "a vehicle driving towards a tunnel entrance portal visible ahead on a multi-lane road",
    ]),
    ("bridge", [
        "a road bridge",
        "an illustration of a bridge over a river or road",
        "vehicles crossing a bridge in a driving test image",
    ]),
    ("roundabout", [
        "a roundabout intersection",
        "an illustration of a roundabout from above",
        "a circular junction with arrows in a driving theory test",
    ]),
    ("roundabout_entrance", [
        "a driver's view of a road leading directly into a roundabout with the circular central island mound clearly visible ahead",
        "a vehicle entering a rotary junction where the circular ring road and raised central island are visible in front",
        "the approach to a roundabout where the curved circular carriageway wrapping around a central raised island is clearly seen ahead",
    ]),
    ("level_crossing", [
        "a railway level crossing with red and white striped barrier arms lowered across the road blocking traffic",
        "a road crossing over train tracks with automatic barrier gates warning lights and stop signs at a paso a nivel",
        "a rural road stopped at a level crossing with the barrier down and railway tracks crossing the road ahead",
    ]),
    ("intersection", [
        "a road intersection or crossroads",
        "vehicles approaching an intersection in a driving test illustration",
        "a junction where two or more roads meet",
    ]),
    ("crosswalk", [
        "a pedestrian crosswalk with zebra stripes",
        "a zebra crossing for pedestrians",
        "a driving test image showing a crosswalk on the road",
    ]),
    ("parking", [
        "a parking lot with parked vehicles",
        "an illustration of cars parked along a street",
        "a parking area with vehicles in a driving test",
    ]),
    ("curve", [
        "a road that physically bends to the left or right ahead with the asphalt visibly curving through the landscape",
        "a driver's perspective view of the road ahead curving around a bend through trees fields or hills reducing forward visibility",
        "a winding road section where the tarmac itself curves in the terrain as seen from inside a vehicle",
    ]),
    ("road_crest", [
        "a driver's forward view where the road asphalt surface itself rises and becomes the horizon line meeting the sky so that nothing beyond the summit is visible",
        "a blind hilltop crest where the tarmac ahead ends abruptly in open sky with no road scenery or vehicles visible beyond the top of the rise",
        "a road where the lane markings go uphill and disappear into the sky directly ahead with the road surface forming the skyline not distant mountains",
    ]),
    # `road_merge` ELIMINADO — duplicado conceptual de `merging_into_traffic`.
    # Datos del run del 25/05: 60% de solapamiento entre los dos (18 de
    # 30 imgs con merging>=0.85 tambien tenian road_merge>=0.85). Para
    # SigLIP zero-shot son sinonimos visuales.

    # ── Vehículos ──────────────────────────────────────────────────
    ("car", [
        "a passenger automobile such as a sedan or hatchback on the road",
        "a photograph of a car driving or parked on the asphalt",
        "a four-wheeled passenger vehicle viewed from the side or behind",
    ]),
    ("truck", [
        "a truck or heavy lorry",
        "an illustration of a truck in a driving test image",
        "a large commercial freight vehicle",
    ]),
    ("trailer", [
        # Remolque enganchado a cualquier vehículo tractor: coche, furgoneta,
        # camión o motocicleta. Incluye caravana, semirremolque, remolque de
        # barco, remolque de carga y sidecar.
        "a car or SUV towing a caravan or trailer behind it on a road with the coupling hitch and towed unit clearly visible",
        "a motorcycle or motorbike with a sidecar or small trailer attached being ridden on a road",
        "a truck or lorry pulling a semi-trailer or large freight trailer on a highway with the articulated coupling visible between cab and trailer",
        "a vehicle towing a utility trailer or boat trailer on a road with the trailer visibly attached to the towing vehicle from behind",
        "a 3D illustration of a car or motorcycle towing a trailer or caravan in a driving test image showing the towed unit attached at the rear",
    ]),
    ("motorcycle", [
        "a motorcycle",
        "an illustration of a motorbike with a rider",
        "a two-wheeled motor vehicle in a driving test",
    ]),
    ("bicycle", [
        "a bicycle with a cyclist",
        "an illustration of a bike on the road",
        "a person riding a bicycle in a driving test image",
    ]),
    ("bus", [
        "a bus or coach",
        "an illustration of a passenger bus",
        "a large public transport vehicle on a road",
    ]),
    ("pedestrian", [
        "pedestrians crossing the street on foot near vehicles",
        "people walking on a sidewalk or crossing the road",
        "a person walking near or across a road in a driving test image",
    ]),
    ("emergency_vehicle", [
        # Reescrito 26/05: antes requería "flashing lights" que rara vez
        # se ven en las ilustraciones DGT. Describir por colores y forma.
        "a white ambulance van with red cross or SAMUR markings parked or driving on a road",
        "a national police or guardia civil patrol car in white and blue or green livery on the street",
        "a red fire truck or fire engine with ladders and emergency equipment in a road scene",
    ]),
    ("agricultural_vehicle", [
        "a tractor with large rear wheels driving on a rural road",
        "a photograph of an agricultural farm vehicle seen from behind on a country road",
        "a tractor or harvester on the asphalt with fields visible alongside",
    ]),
    ("van", [
        "a delivery van or commercial vehicle",
        "an illustration of a van or panel truck",
        "a small box truck used for commercial transport",
    ]),
    ("turn_signal_active", [
        "a vehicle with its amber turn signal blinker light actively flashing indicating an upcoming turn or lane change",
        "a car with its orange indicator light illuminated on the rear or front showing an active directional signal",
        "a vehicle showing an active direction indicator light blinking to signal an intended change of direction on the road",
    ]),

    # ── Señalización ──────────────────────────────────────────────
    ("traffic_sign_vertical", [
        # Reescrito 26/05: antes 39% precisión — demasiado broad. Ahora
        # enfatizar que la señal es el FOCO de la imagen (close-up,
        # prominent) y no decoración periférica.
        "a close-up prominent view of a single round triangular or octagonal vertical traffic sign mounted on a metal post filling most of the frame",
        "a road sign on a vertical pole shown as the main subject of the image with text or pictogram clearly legible",
        "an isolated traffic sign mounted on its post photographed or illustrated as the central element with sky or simple background behind",
    ]),
    ("road_marking", [
        "white painted directional arrows turn indicators or lane markings clearly visible on the road asphalt surface in a driving scene",
        "road surface with painted symbols such as straight or curved arrows speed numbers stop lines or lane dividers visible on the pavement",
        "a road where horizontal markings painted on the asphalt are prominent including arrows chevrons or crossing lines",
    ]),
    ("traffic_light", [
        "a traffic light with red yellow green signals",
        "an illustration of a traffic signal at an intersection",
        "a stoplight on a pole controlling traffic",
    ]),
    ("traffic_light_warning_sign", [
        "a triangular red-bordered warning road sign with a traffic light pictogram inside it",
        "a triangular warning sign with a traffic light symbol indicating a signalized intersection ahead",
        "a road warning sign depicting a traffic light ahead alerting drivers to an upcoming controlled junction",
    ]),
    ("sign_prohibition", [
        "a round red-bordered prohibition traffic sign",
        "a circular sign with red border indicating no entry or restriction",
        "an illustration of a prohibition road sign in red and white",
    ]),
    ("sign_warning", [
        "a triangular traffic warning sign with red border",
        "a yellow or white triangular warning sign on the road",
        "an illustration of a hazard warning traffic sign",
    ]),
    ("sign_mandatory", [
        "a round blue mandatory traffic sign with white symbol",
        "a blue circular sign indicating obligation or direction",
        "an illustration of a mandatory road sign in blue",
    ]),
    ("sign_information", [
        "a rectangular blue or white information traffic sign",
        "a square or rectangular informational road sign",
        "an illustration of an informational traffic sign",
    ]),
    ("sign_priority", [
        "a priority yield or stop traffic sign",
        "an illustration of a give-way or stop sign at a junction",
        "a triangular yield sign or octagonal stop sign",
    ]),

    # ── Señales específicas (los pictogramas más identificables) ──────
    ("sign_stop", [
        "an octagonal red STOP traffic sign with white letters",
        "a red eight-sided sign saying STOP",
        "an illustration of a STOP sign at an intersection",
    ]),
    ("sign_yield", [
        "an inverted triangular yield sign with red border",
        "a give-way traffic sign pointing downward",
        "an illustration of a yield or ceda el paso sign",
    ]),
    ("sign_speed_limit", [
        "a round red speed limit sign with a number inside",
        "a circular traffic sign showing maximum allowed speed in kilometers",
        "an illustration of a speed limit road sign with a numeric value",
    ]),
    ("sign_no_overtaking", [
        "a round red traffic sign showing two cars with no overtaking allowed",
        "a circular sign prohibiting passing other vehicles",
        "an illustration of a no overtaking traffic sign",
    ]),
    ("sign_no_entry", [
        "a round red sign with a white horizontal bar meaning no entry",
        "a do-not-enter traffic sign with red circle and white rectangle",
        "an illustration of a no entry road sign",
    ]),
    ("sign_pedestrian_crossing", [
        "a traffic sign warning of a pedestrian crossing ahead",
        "a road sign with a walking person symbol indicating crosswalk",
        "an illustration of a pedestrian crossing warning sign",
    ]),
    ("sign_works", [
        # Las señales de obras españolas tienen FONDO AMARILLO (no blanco).
        # Cubre tanto señales verticales aisladas como escenas reales de carretera
        # con balizamiento amarillo, conos y pintadas en el asfalto.
        # ── Señales verticales aisladas ──
        "a warning sign showing a worker shoveling or digging with a yellow amber background indicating road works ahead",
        "a triangular road works warning sign with yellow or amber background and a black worker shoveling symbol inside a red border",
        "a yellow background road works construction warning sign of any shape with worker or machinery symbols on yellow",
        "an illustration of a roadworks ahead traffic sign with yellow background",
        # ── Escena real de carretera con señalización de obras ──
        "a real road or highway scene with temporary yellow background signs and orange cones or barriers diverting traffic through an active road works zone",
        "a photograph of a road construction zone where yellow temporary signs with black text or symbols are placed alongside the carriageway guiding vehicles around works",
        "a real street or motorway with yellow painted road markings or yellow delineator posts replacing the normal white lane markings due to road works",
        "a driver's view of a road ahead where yellow signs on posts or gantries and orange cones indicate an active construction zone with lane deviations",
    ]),
    ("sign_priority_road", [
        "a yellow diamond-shaped priority road traffic sign",
        "a square sign rotated 45 degrees in yellow indicating priority road",
        "an illustration of a yellow rhombus priority road sign",
    ]),

    # ── Interior coche / mecánica ─────────────────────────────────
    ("dashboard", [
        "a car dashboard with steering wheel viewed from driver seat",
        "an illustration of the interior of a vehicle dashboard",
        "the cockpit of a car showing instruments and controls",
    ]),
    ("warning_light", [
        "an illuminated warning indicator on a car dashboard",
        "a glowing dashboard warning symbol",
        "an illustration of a dashboard warning icon lit up",
    ]),
    ("mechanical", [
        # Reescrito 26/05: los prompts previos eran demasiado abstractos
        # ("suspension assembly" / "shock absorber") y SigLIP no los
        # vinculaba a las ilustraciones de mecánica de los libros DGT
        # (esquemas COLOREADOS con muelle verde, amortiguador rojo,
        # palancas naranjas, etc).
        "a colored cutaway illustration of a car engine showing pistons valves cylinders and internal mechanical parts in red blue and yellow",
        "a side-view diagram of a car wheel suspension with a coiled spring shock absorber and control arms drawn in bright colors",
        "an educational schematic of automotive mechanical parts like brakes pistons or transmission shown in cross-section with colored components",
    ]),
    ("tires_wheels", [
        "close-up of car tires or wheels",
        "an illustration of vehicle tires with tread pattern",
        "automotive wheels and tires viewed up close",
    ]),
    ("car_mirror", [
        "a car rear-view or side mirror",
        "the reflection inside a vehicle mirror",
        "an illustration of a rear-view mirror in a driving test",
    ]),
    ("driver_pov_interior", [
        "a first-person photograph from inside a car showing the driver's hand on the steering wheel and the road visible through the windshield",
        "interior view of a vehicle from the driver's seat during a driving lesson with hands on the steering wheel and outside scenery ahead",
        "a driving school point-of-view shot showing the steering wheel dashboard and road ahead through the windscreen",
    ]),
    ("airbags_xray", [
        "an X-ray or cutaway 3D illustration of a car interior showing deployed airbags and seatbelts in transparent view",
        "a transparent vehicle diagram displaying inflated airbags safety belts and restraint systems inside",
        "an educational rendering of a car with visible safety systems including airbags and seat belts as if seen through the body",
    ]),

    # ── Condiciones meteorológicas ────────────────────────────────
    ("night", [
        "a nighttime road scene with vehicle headlights",
        "an illustration of driving at night in darkness",
        "a dark road with cars using their lights",
    ]),
    ("night_highway_lit", [
        "a multi-lane highway or autovía with overhead streetlights and cars driving at night with full illumination",
        "a well-lit highway with several lanes and vehicles traveling at nighttime under artificial road lighting",
        "a busy highway scene illuminated by streetlights showing multiple lanes and traffic during nighttime hours",
    ]),
    ("rain", [
        "rainy weather with wet road surface",
        "an illustration of driving in rain with water on the road",
        "raindrops falling and wet asphalt in a driving test image",
    ]),
    ("fog", [
        "foggy weather with very low visibility",
        "an illustration of driving in heavy fog or mist",
        "a road obscured by thick fog",
    ]),
    ("snow", [
        "snow covering the road or winter driving conditions",
        "an illustration of driving in snowy weather",
        "a road covered with snow and winter scenery",
    ]),
    ("snow_chains", [
        "a close-up of a car tire fitted with metal snow chains for winter driving",
        "snow chains or traction devices wrapped around a vehicle wheel on snowy ground",
        "a tire with installed snow chains gripping a snow-covered road surface",
    ]),
    ("snow_plow", [
        "a snow plow truck with a large front blade clearing snow from a road",
        "a winter maintenance vehicle pushing snow off the highway",
        "a road snowplow with a yellow or orange blade removing accumulated snow",
    ]),
    ("icy_road", [
        # Reescrito 26/05: añadir indicios visuales más específicos
        # (reflejo brillante, derrape, frost blanco) para que SigLIP
        # distinga hielo de simplemente nieve o lluvia.
        "a road surface with shiny reflective black ice patches creating a slippery glossy appearance on the asphalt",
        "a winter road with white frost crystals or thin transparent ice layer covering the pavement and tire skid marks",
        "an asphalt highway with visible glaze ice or freezing conditions and a car sliding with skid marks behind it",
    ]),
    ("winter_driving_scene", [
        "a car driving on a road covered with snow and slush in winter conditions",
        "a sedan or vehicle navigating a snowy mountain road during winter",
        "a photograph of a car on an icy snowy road with winter scenery around",
    ]),

    # ── Tipos especiales de imagen ────────────────────────────────
    ("schematic_diagram", [
        "a top-down schematic diagram with arrows showing road priority rules",
        "an overhead view illustration of an intersection with directional arrows",
        "a road diagram showing right-of-way rules at a junction",
    ]),
    ("overtaking", [
        "a vehicle overtaking or passing another vehicle",
        "an illustration of one car passing another on the road",
        "a passing maneuver with two cars in a driving test image",
    ]),
    ("traffic_accident", [
        # Colisiones DGT: pueden ser de baja energía, sin daños visibles ni
        # emergencias — lo que importa es el contacto o conflicto inminente
        # entre vehículos en posición de impacto.
        "a car and a motorcycle or scooter colliding or making contact on a road with the two vehicles extremely close together in an impact position",
        "two vehicles involved in a road collision with one car hitting or making contact with another vehicle at an intersection or on a street",
        "a traffic accident scene showing a crashed or colliding car and motorcycle in close contact on an urban road without emergency services present",
        "a road accident with damaged crashed vehicles debris on the road and emergency responders in high-visibility vests attending the scene",
        "a car crash at an intersection with multiple damaged vehicles and rescue personnel responding to the collision",
    ]),
    # `merging_into_traffic` ELIMINADO — precisión real ~3%. Datos del
    # run del 25/05: de 30 imgs con score>=0.85, solo 1 era "merging
    # puro" sin otro tag más específico. Las otras 29 eran adelantamientos
    # (28), intersecciones (13), esquemas (8), rotondas (6)… SigLIP en
    # zero-shot no distingue "incorporar" de "estar en escena de tráfico".
    # Las preguntas DGT de incorporación se capturan mejor por la combo
    # `intersection` + `schematic_diagram`, o `highway` + señales.
    ("traffic_officer_signal", [
        # Reescrito 26/05: confundía con `jaywalking` (que ganaba 0.85-
        # 0.97 en imágenes de policías en intersección). Enfatizar
        # uniforme (azul oscuro Policía Local o verde fluorescente
        # Guardia Civil), gorra, posición central de la calzada y gesto
        # de dirigir tráfico — TODOS visuales claves que un peatón
        # cruzando NO tiene.
        "a uniformed police officer with peaked cap and reflective vest standing in the center of an intersection directing traffic with raised arm gestures",
        "a Spanish Policía Local or Guardia Civil officer in dark blue or fluorescent green uniform performing manual traffic control with hand signals on the road",
        "a traffic agent in official uniform with badge and cap standing still at a crossroads gesturing to vehicles to stop or proceed with extended arms",
    ]),
    ("pedestrian_at_risk", [
        "a hazardous traffic situation with a vehicle approaching a pedestrian on or near the road",
        "a person standing in the path of a moving car creating a near-collision risk",
        "a 3D illustration of a parking area with a car about to hit a pedestrian between vehicles",
    ]),
    ("gas_station", [
        "a car parked at a gas station next to a fuel pump for refueling",
        "a vehicle refueling at a petrol station with visible gasoline dispensers",
        "a service station with cars and fuel pumps in the foreground",
    ]),
    ("first_aid_at_accident", [
        "people helping or assisting an injured person at the scene of a traffic accident",
        "bystanders providing first aid to a victim of a motorcycle or pedestrian accident on the street",
        "a scene of pedestrians supporting an injured cyclist or biker after a crash on the road",
    ]),

    # ── Peatones y convivencia ───────────────────────────────────────
    # Imágenes que tratan sobre el peatón como SUJETO y sobre la
    # convivencia cívica entre conductores y peatones. Útil para
    # preguntas DGT del tipo "¿qué debe hacer el conductor cuando…?"
    # con escenas de cesión de paso, peatones vulnerables (mayores,
    # niños, discapacidad), distracciones (móvil), visibilidad reducida,
    # y cruces indebidos.
    #
    # Nota: el tag `pedestrian` ya existe arriba en la sección
    # "Vehículos" del código pero se renderiza en esta categoría en
    # la UI (ver labelMetadata.ts). Aquí solo añadimos los nuevos.
    ("yielding_to_pedestrian", [
        "a car stopped at a pedestrian crossing letting a person walk across the road",
        "a driver yielding right of way to a pedestrian about to step onto a zebra crossing",
        "a vehicle politely halted as a pedestrian crosses the street in front of it",
    ]),
    ("jaywalking", [
        # Reescrito 26/05: confundía agentes de tráfico (parados en
        # intersecciones) con peatones cruzando. Enfatizar que es un
        # CIVIL en MOVIMIENTO atravesando la calle, sin uniforme ni
        # gestos de dirigir tráfico — visualmente lo opuesto a un
        # policía estático en el centro de la calzada.
        "a civilian pedestrian in everyday casual clothes walking across the asphalt mid-crossing far from any zebra stripes",
        "a person in normal street clothes stepping diagonally onto a road in motion between moving cars without a pedestrian crossing nearby",
        "a regular citizen mid-stride crossing a busy street outside of a designated crosswalk with traffic on both sides",
    ]),
    ("elderly_pedestrian", [
        "an elderly person walking with a cane or walking stick near or across a road",
        "a senior citizen crossing the street slowly with a walker or assistance",
        "an older adult pedestrian on the sidewalk or crosswalk near traffic",
    ]),
    ("child_pedestrian", [
        # Reescrito 26/05: 0 emisiones — antes era casi sinónimo de
        # `pedestrian`. Enfatizar la pequeña altura, la mochila escolar
        # y el contexto de "niño" para distinguir del peatón adulto.
        "a small young child of low height walking or crossing the street with adult holding their hand near road traffic",
        "a school-age kid wearing a backpack illustrated as a small short figure near a crosswalk or sidewalk",
        "children drawn as small short figures next to taller adults crossing the road in a driving theory illustration",
    ]),
    ("pedestrian_with_disability", [
        "a person in a wheelchair crossing the street or on the sidewalk near traffic",
        "a blind pedestrian using a white cane to navigate a crosswalk",
        "a pedestrian with a visible mobility disability walking or crossing the road",
    ]),
    ("distracted_pedestrian", [
        "a pedestrian looking at a smartphone while crossing the street near traffic",
        "a person walking on the road distracted by their mobile phone",
        "a pedestrian wearing headphones or using a phone while walking close to vehicles",
    ]),
    ("group_of_pedestrians", [
        "a group of pedestrians crossing the street together at a crosswalk",
        "several people walking in a crowd on the sidewalk near a road",
        "multiple pedestrians waiting to cross or crossing the road in a group",
    ]),
    ("pedestrian_at_night", [
        "a pedestrian walking on or near the road at night with poor visibility",
        "a person crossing the street in the dark or at dusk illuminated by headlights",
        "a pedestrian visible only in vehicle headlights on a dark road at nighttime",
    ]),

    # ── Más Factor vehículo + Condiciones + Señales ─────────────────
    ("tow_truck_assistance", [
        # Grúa de asistencia cargando un coche averiado en su plataforma
        # basculante. Típico: trabajador con chaleco amarillo, capó del
        # coche abierto, rampa de la grúa inclinada.
        "a tow truck or recovery vehicle with a tilted flatbed platform loading a broken down car from the roadside",
        "a roadside assistance scene with a worker in a yellow high-visibility vest hooking up a disabled car with its hood open to a tow vehicle ramp",
        "a vehicle breakdown on a highway shoulder being recovered by a flatbed tow truck with the car's bonnet open and assistance personnel attending",
    ]),
    ("itv_sticker", [
        # Pegatinas españolas de la ITV (Inspección Técnica de Vehículos):
        # rectangulares, colores rojo/verde/amarillo, con números romanos
        # I-XII (meses) y un número grande de año "Válido hasta".
        "a colored rectangular ITV inspection sticker for Spanish vehicles with Roman numerals I to XII at the top showing months and a large bold year number under 'Válido hasta' text",
        "Spanish technical vehicle inspection certificate stickers in red green or yellow with month markings I-XII and an expiration year prominently displayed",
        "three overlapping ITV revision stickers attached to a windshield with Comunidad de Madrid logo Roman numeral months and validity year",
    ]),
    ("edge_delineator_post", [
        # Hito de arista español: poste vertical blanco angosto con tres
        # franjas rojas en diagonal. Marca el borde de la calzada en
        # tramos sin línea blanca continua o en zonas peligrosas.
        "a tall narrow white roadside delineator post with three diagonal red stripes used to mark the edge of a road",
        "a vertical white edge marker beacon with angled red bands indicating the road shoulder or boundary in Spain",
        "a slim rectangular white road delineator post with three oblique red diagonal stripes painted on its surface for marking the limit of the carriageway",
    ]),
    ("night_driving_low_visibility", [
        # Específico para POV de conductor en carretera abierta de noche
        # SIN iluminación urbana. Solo se ven las marcas viales en el
        # haz de los faros y oscuridad total alrededor. Distinguir de
        # `night` genérico (que cubre escenas nocturnas con luces).
        "a first-person driver POV photograph of a deserted asphalt road at night with only the road markings illuminated by headlights and complete darkness on both sides",
        "a nighttime driving view from the windshield of an open highway in pitch darkness showing white edge and center lines barely visible in the headlight beam",
        "an extremely dark rural road scene from inside a moving car at night with very low visibility and the headlights revealing only a few meters of pavement ahead",
    ]),
    ("construction_vehicle", [
        # Maquinaria pesada de obra: retroexcavadora, excavadora,
        # bulldozer, dumper, hormigonera. Color amarillo industrial
        # habitual + brazo hidráulico + cuchara/cazo. Distinguir de
        # `agricultural_vehicle` (tractores en campo/carretera rural).
        "a yellow heavy construction vehicle like a backhoe loader excavator or bulldozer parked at a construction site or work yard",
        "a New Holland or Caterpillar heavy machinery with a front loader bucket and a rear digging hydraulic arm on a job site",
        "industrial earth moving equipment with hydraulic arms large rubber tires and metal bucket used for digging or loading at a construction area",
    ]),
    ("auto_part_isolated", [
        # GENÉRICO para componentes del vehículo mostrados aislados
        # (fondo blanco/neutro o esquema técnico): filtros (aire,
        # aceite, combustible), baterías, bujías, correas, pastillas
        # de freno, neumáticos en sección, etc. Evita la explosión de
        # labels específicos por cada tipo de pieza.
        "a single isolated automotive replacement part such as an air filter oil filter spark plug car battery brake disc or alternator shown on a plain white or neutral background",
        "a product close-up photograph of one automotive component like a cylindrical air filter fuel filter brake pad timing belt or starter motor without any vehicle context around it",
        "an educational diagram or cross-section illustration of a single isolated vehicle part such as a tire battery filter or brake component shown for identification purposes against a clean background",
    ]),
    ("family_safety_in_car", [
        # Escena de seguridad familiar: adulto conduciendo con cinturón,
        # niños atrás con cinturón Y/O sillita infantil con arnés.
        # Típico de preguntas DGT sobre transporte de menores, retención
        # apropiada por edad/talla.
        "a car interior with a mother or father driver wearing a seatbelt looking at her children in the back seat one in a child safety seat with harness and another wearing a regular seatbelt",
        "an illustration of a family inside a vehicle with the parent driving with seatbelt fastened and the kids properly restrained in the rear with child safety seats or seat belts",
        "an automotive cabin interior scene from the side viewpoint showing safe family travel with both children correctly secured in proper child seats and adult seatbelts",
    ]),
    ("fatigue_warning_dashboard", [
        # Específico para la ALERTA de detección de fatiga en el cuadro
        # de mandos (mensaje "Fatiga detectada / Tome un descanso" +
        # icono de taza de café). Es un sistema ADAS — diferente de
        # `driver_fatigue` (que es el conductor cansado en sí).
        "a car dashboard instrument cluster screen showing a fatigue detected warning message in Spanish 'Fatiga detectada Tome un descanso' with a steaming coffee cup icon",
        "a vehicle multifunction display alerting the driver of detected fatigue with a 'take a break' notification a coffee mug pictogram and surrounding tachometer and speedometer dials",
        "an automotive driver assistance system warning popup on the dashboard recommending a rest stop due to detected drowsiness with a hot beverage symbol",
    ]),
    ("vehicle_documents", [
        # Documentación obligatoria del vehículo y conductor (España):
        # permiso de circulación, ficha técnica/ITV, póliza de seguro,
        # permiso de conducción. Tipo de imagen DGT de preguntas sobre
        # qué papeles llevar / quién puede pedirlos.
        "a flat lay of Spanish vehicle and driver documents including the permiso de circulación insurance policy ITV technical inspection card and pink driver license laid out on a desk",
        "official paper documents required for driving a car in Spain such as registration certificate from Comunidad Europea insurance contract papers technical inspection card and pink folded driving license with photo",
        "a desk view showing the mandatory documentation for a car and its driver in Spain: green permiso de circulación blue or pink driver license ITV inspection card with stamps and insurance company contract",
    ]),
    ("alcohol_consumption", [
        "a bottle of wine or spirits and glasses filled with alcoholic drinks on a table indicating social drinking",
        "alcoholic beverages served in a social setting with a bottle and filled glasses indicating alcohol consumption",
        "a bottle of champagne wine or beer next to glasses indicating drinking activity that impairs driving ability",
    ]),
    ("medicamentos", [
        # Pastillas/medicamentos sobre superficie — preguntas DGT sobre
        # medicamentos que afectan a la conducción (drogas legales).
        # RECUPERADO del antiguo discovered_labels.json (Groq lo descubrió
        # el 25/05). Movido aquí para que no se pierda si se borra el JSON
        # de discovered.
        "a collection of various colored pills capsules and tablets scattered on a flat surface or table next to a pill bottle",
        "an assortment of different shaped medication pills in red blue yellow and white colors viewed from above for a pharmacology context",
        "a close-up of prescription medicine tablets and capsules spread on a surface illustrating drugs that can affect a driver's ability to operate a vehicle safely",
    ]),

    # ── Recuperados del discovered_labels.json (Groq/Gemini 25/05) ──
    # Estos labels los descubrió IA en runs previos y vivían en
    # discovered_labels.json. El JSON se perdió en un borrado manual
    # → los movemos al código para que sobrevivan a reinicios.
    ("wild_animals_crossing_sign", [
        "a triangular warning road sign with red border depicting a leaping deer silhouette indicating wild animals may cross",
        "a Spanish traffic warning sign showing a deer or stag in black silhouette inside a red-bordered triangle alerting drivers to wildlife crossing",
        "a yield-style triangular road sign featuring a jumping antlered animal symbol warning of possible wild animal presence on the road",
    ]),
    ("steering_wheel", [
        "a close-up of a car steering wheel with one or two hands gripping it from the driver's perspective inside a vehicle",
        "a photograph focusing on the round steering wheel of an automobile with the dashboard partially visible behind",
        "a black or leather steering wheel held by hands at the 10-and-2 or 9-and-3 position with the car interior in the background",
    ]),
    ("gps_device", [
        "a portable GPS navigation device or satnav mounted on a car windshield or dashboard showing a map and route directions",
        "a TomTom or Garmin style navigation unit with a touchscreen displaying turn-by-turn directions inside a vehicle interior",
        "a stand-alone GPS receiver attached with a suction cup to the front windshield of a car with road maps visible on its screen",
    ]),
    ("child_seat", [
        "a child safety seat or booster seat installed in the back of a car with a young child or baby strapped in with a harness",
        "an infant car seat secured with a 5-point harness in the rear of a vehicle showing a baby or toddler restrained safely",
        "a children's car seat with high back wings in the back row of a vehicle with the kid seated inside and harness fastened",
    ]),
    ("seat_belt", [
        "a close-up of a seat belt diagonal strap fastened across a person's chest and shoulder inside a car",
        "a fastened automotive safety belt buckle and webbing across the body of a driver or passenger in a vehicle seat",
        "a three-point seat belt visibly fastened across a passenger torso with the metal buckle clicked into the receiver",
    ]),

    # ── Factor vehículo (mantenimiento) ─────────────────────────────
    # Estado y mantenimiento del coche: presión de ruedas, mecánica,
    # ITV, reparación. Específicos al examen DGT — preguntas tipo
    # "¿cada cuánto comprobar la presión?" o "¿qué hacer si se
    # enciende el testigo?"
    ("tire_inflation_check", [
        "a person inflating a car tire with an air compressor hose attached to the wheel valve",
        "hands using an air pump nozzle on a vehicle tire to check or adjust pressure at a gas station",
        "a close-up of someone refilling air into a parked car tire with a flexible hose",
    ]),
    ("vehicle_maintenance_general", [
        "a mechanic performing maintenance on a car engine inside a garage workshop with tools",
        "a person checking the engine bay under the open hood of a vehicle with a toolbox nearby",
        "an automotive service scene with a car on a lift or jack and maintenance equipment around",
    ]),

    # ── Factor humano (estado del conductor) ────────────────────────
    # Fatiga, ergonomía, distracción. Tipos de pregunta DGT como
    # "síntomas de fatiga", "postura correcta al volante", "uso del
    # móvil al conducir".
    ("driver_fatigue", [
        # Reescrito 26/05: confundía con `proper_driving_posture` y
        # `driver_allergy_symptoms`. Ahora enfatiza elementos VISUALES
        # únicos: ojos cerrados, bostezo, "bare hand" (sin objeto)
        # tocando frente/sien, cabeza caída — SIN nada en las manos.
        "a tired drowsy driver inside a car with eyes closed or barely open and head leaning forward showing physical exhaustion behind the wheel",
        "a sleepy driver yawning widely with mouth wide open or rubbing closed eyes with a bare empty hand showing visible fatigue at the steering wheel",
        "a fatigued person at the wheel with bare hand resting on the forehead or temple and a visible expression of sleepiness and tiredness",
    ]),
    ("proper_driving_posture", [
        # Reescrito 26/05: enfatizar el diagonal del cinturón y la
        # postura activa (ambas manos al volante, mirada al frente,
        # sin gestos faciales) para distinguir de fatigue/allergy.
        "side view of an alert driver sitting upright at the steering wheel with both hands gripping it and the diagonal seatbelt strap across the chest",
        "an ergonomic driving demonstration with hands at 9 and 3 on the steering wheel back firm against the seat and the diagonal seatbelt clearly buckled",
        "a driver from the passenger side showing proper grip on the wheel a black diagonal seatbelt legs reaching the pedals and eyes looking forward",
    ]),
    ("driver_distraction", [
        "a driver looking at or texting on a smartphone while driving a car with attention away from the road",
        "a distracted motorist eating drinking or using a mobile device while behind the wheel of a moving vehicle",
        "a person with hands off the wheel doing other tasks instead of focusing on the road ahead while driving",
    ]),
    ("driver_allergy_symptoms", [
        # Reescrito 26/05: el TISSUE/KLEENEX BLANCO es el elemento más
        # visual y único — antes confundía con fatigue (que también tiene
        # mano cerca de cara). Repetimos "white paper tissue / kleenex"
        # para que SigLIP lo asocie fuertemente al label.
        "a driver in a car holding a white paper tissue pressed against the nostrils with hand visible in a nose-wiping action",
        "a person at the steering wheel using a white tissue or kleenex to cover the nose during a sneeze with paper visible across the face",
        "a motorist inside a vehicle holding a folded white paper tissue up to the nose in an allergy sneeze pose with watery eyes",
    ]),

    # ── Controles policiales ────────────────────────────────────────
    # Alcoholímetros (dispositivo y test policial), drogas, controles
    # de tráfico. Foto típica del examen DGT de las preguntas sobre
    # tasas de alcohol o procedimientos en un control.
    ("breathalyzer_device", [
        "a close-up of a digital handheld breathalyzer device displaying a blood alcohol concentration reading on its LCD screen",
        "a blue Dräger Alcotest or similar breath alcohol tester held in a hand showing a numeric value of grams per liter",
        "a portable breath alcohol detection device with on and ready indicator lights and a digital screen showing test result",
    ]),
    ("police_breathalyzer_test", [
        "a uniformed police officer administering a breathalyzer test to a driver through the open car window during a roadside check",
        "a traffic policeman in a high-visibility vest holding a breath alcohol testing device while a motorist seated in the car blows into the mouthpiece",
        "a roadside alcohol or drug control with an officer carrying out an alcohol test on a driver inside their parked vehicle",
    ]),

    # ── Intersection maneuver & first-aid maneuver ─────────────────
    # Casos típicos del examen DGT — escenas 3D ilustradas con cruces
    # complejos o rotondas (a veces con accidente) y escenas de socorro
    # con un transeúnte atendiendo a una víctima en el suelo.
    ("lane_merge_diverge", [
        "a highway or dual carriageway where a lane splits off or merges in with a white triangular painted nose island separating the main road from the new lane",
        "a road fork or merge point showing the triangular hatched area at the tip where two lanes diverge or converge on a motorway",
        "a vehicle accelerating on an entry slip lane or decelerating on an exit lane at a motorway junction with the triangular road marking nose visible ahead",
    ]),
    ("intersection_maneuver", [
        "a 3D illustration of cars maneuvering at a roundabout or junction with potential conflict between vehicles approaching from different directions",
        "an overhead or perspective view of multiple cars navigating an intersection or rotary including a possible collision in the middle of the crossroads",
        "an illustration of vehicles turning yielding or merging at a road intersection with signs indicating right of way priorities",
    ]),
    ("intersection_priority_diagram", [
        # Sub-tipo MUY característico de las preguntas DGT de prioridad:
        # vista cenital de cruce de 4 ramales con varios vehículos
        # (camión + coche + bici/moto típicamente) y flechas grandes de
        # colores (rojas habitualmente) indicando la trayectoria pretendida
        # de cada uno. A veces los vehículos están etiquetados como A, B,
        # C, D para que la pregunta diga "¿quién pasa primero, A o B?".
        # Sin contexto urbano real — fondo plano gris/verde, sin
        # edificios ni vegetación detallada.
        "a top-down overhead diagram of a four-way intersection with multiple vehicles like a truck a car and a bicycle approaching from different branches with thick red directional arrows showing their intended trajectories",
        "an aerial bird's eye view illustration of a crossroads with two or three vehicles at different arms of the junction and bold colored arrows pointing in each vehicle's intended direction for a right of way driving theory question",
        "a flat top-view driving theory question image of a four-arm crossroads with several vehicles sometimes labeled with letters A B C D and large colored arrows indicating which way each one wants to go to test priority rules",
    ]),
    ("first_aid_maneuver", [
        "a bystander kneeling beside an injured person lying on the asphalt performing first aid maneuvers like CPR or recovery position after a traffic accident",
        "a 3D illustration of a rescuer attending to a victim on the ground at the scene of a road collision between two cars",
        "a person providing first aid chest compressions or lateral safety position to an unconscious victim laid on the road next to a car crash",
    ]),
    ("moped", [
        # Rasgos distintivos del ciclomotor frente a moto: cuadro step-through
        # (sin tubo superior), ruedas pequeñas (≤12 pulgadas), carrocería redondeada
        # compacta, floorboard plano, sin depósito visible en el tubo superior.
        # Cubre tanto fotos reales como ilustraciones 3D estilo DGT.
        "a small step-through scooter or moped with a compact rounded body small wheels and a flat floorboard between the handlebars and the seat ridden on a road",
        "a low-powered automatic scooter with a step-through frame no large fuel tank on top small wheels and a compact rounded chassis typical of a ciclomotor or Vespa-style moped",
        "a 3D illustration of a person riding a small classic scooter or moped with a rounded step-through body small wheels and upright posture typical of a 50cc ciclomotor in a driving test image",
        "a small urban moped or scooter with a low step-through entry rounded plastic or metal bodywork small wheels and an upright riding posture characteristic of a 50cc automatic two-wheeler",
    ]),
    ("cyclist_on_road", [
        "a real photograph of a cyclist riding on the edge or right shoulder of a road or highway with motor vehicles following or approaching from behind",
        "a driver's forward view from inside a car of a bicycle rider ahead on the carriageway pedalling along the asphalt",
        "a cyclist sharing the road with cars seen from behind through the windscreen of a following vehicle on a real road",
    ]),
    ("vehicle_breakdown", [
        "a car stopped on the road or hard shoulder with the boot bonnet or trunk open indicating a mechanical breakdown with no collision damage visible",
        "a broken down vehicle parked on the roadside with the driver standing outside the car or with the boot lid raised showing a vehicle fault stop",
        "a car immobilised on the road with its trunk or hood open and a triangle or hazard sign behind it indicating an emergency stop due to vehicle failure",
    ]),
]

# Prompts negativos por label — reducen falsos positivos restando la similitud
# con escenas que se confunden con la label positiva.
# Se aplica: adj_prob = (pos_prob - NEG_WEIGHT * neg_prob).clamp(0, 1)
LABEL_NEGATIVES: dict[str, list[str]] = {
    # jaywalking dispara en cruces controlados por policía (hay personas cruzando)
    "jaywalking": [
        "a police officer in uniform directing vehicle traffic at an intersection",
        "a traffic officer standing in the road controlling cars with hand signals",
        "a pedestrian crossing legally at a marked crosswalk with traffic lights",
    ],
    # traffic_officer_signal dispara cuando solo hay peatones cruzando sin agente
    "traffic_officer_signal": [
        "a pedestrian crossing the street alone without any police officer nearby",
        "a person walking across a road informally with no traffic control officer",
    ],
    # driver_fatigue se confunde con alergia/estornudo (ojos cerrados momentáneamente)
    "driver_fatigue": [
        "an alert driver with both eyes open and upright posture at the wheel",
        "a driver sneezing with a tissue while staying focused on the road",
    ],
    # proper_driving_posture dispara en imágenes de fatiga o estornudo al volante
    "proper_driving_posture": [
        "a tired driver with closed or drooping eyes while behind the wheel",
        "a driver yawning or showing signs of drowsiness while driving",
    ],
    # driver_allergy_symptoms se confunde con fatiga (gestos faciales similares)
    "driver_allergy_symptoms": [
        "a drowsy driver with heavy eyelids or head drooping while driving",
        "a driver showing fatigue or sleepiness with eyes closing at the wheel",
    ],
    # divided_highway no debe disparar en carreteras sin mediana
    "divided_highway": [
        "a narrow two-way road without any central barrier or divider",
        "a single carriageway road with no median separation between lanes",
    ],
    # single_lane_road no debe disparar en autopistas con mediana
    "single_lane_road": [
        "a wide road with a concrete or guardrail median separating both directions",
        "a divided highway with central barriers between opposing traffic lanes",
    ],
    # road_crest no debe disparar en: montañas de fondo con carretera plana,
    # autopistas con buen horizonte, curvas horizontales, bajadas despejadas
    "road_crest": [
        "a road with mountains or hills visible in the distant background but the road surface itself is flat and clearly visible stretching far ahead",
        "a highway or rural road going uphill where the road surface with lane markings is still clearly visible far ahead and vehicles can be seen in the distance",
        "a road where the horizon is formed by mountain ridges in the background not by the road surface itself meeting the sky",
        "a road bending horizontally left or right around a curve with the road surface visible throughout without a blind summit",
        "a clear downhill road where the driver can see far ahead down the slope with no abrupt hidden horizon formed by the road",
    ],
    # curve no debe disparar en carreteras rectas con flechas de trayectoria dibujadas
    # ni en vistas cenitales de maniobras con flechas curvas animadas
    "curve": [
        "a perfectly straight road extending ahead with no bend or turn visible on the horizon",
        "an overhead view of cars on a road with a curved animated arrow drawn over them to indicate a vehicle's trajectory or overtaking path",
        "a straight road with a curved directional arrow painted or drawn on the asphalt indicating a lane change or maneuver",
    ],
    # lane_merge_diverge no debe disparar en adelantamiento simple, intersección normal o glorieta
    "lane_merge_diverge": [
        "a vehicle overtaking or passing another car on a straight road with no lane splitting or merging",
        "a standard crossroads or T-junction intersection with no triangular nose island or slip lane",
        "a roundabout with a circular central island and vehicles going around it",
    ],
    # trailer no debe disparar en vehículos sin remolque ni en camiones rígidos
    "trailer": [
        "a car or SUV driving alone on the road with nothing attached behind it and no towing hitch or coupling visible",
        "a motorcycle or motorbike being ridden alone without any sidecar trailer or attached unit",
        "a rigid truck or lorry with no semi-trailer attached driving as a single unit with no coupling or towed section",
    ],
    # sign_works no debe disparar en señales triangulares de peligro normales
    # (fondo blanco) como gravilla, puente, curva, etc.
    "sign_works": [
        "a standard triangular danger warning sign with a white background and red border showing a road hazard symbol such as gravel loose chippings a bridge or a curve",
        "a triangular road warning sign with white background showing a danger symbol but no yellow or amber colouring on the sign face",
        "a regular hazard warning sign with white background and red triangular border indicating a permanent road danger with no yellow colouring",
    ],
    # level_crossing no debe disparar en barreras de obra ni pasos de peatones
    "level_crossing": [
        "orange and white construction barriers blocking a road work zone with cones and no railway tracks",
        "a pedestrian zebra crossing on a road with no train tracks or railway barrier arms",
        "a road barrier or guardrail on a highway without any railway infrastructure or train tracks",
    ],
    # roundabout_entrance dispara en: señales de ceda el paso en cruce normal,
    # carreteras con flechas en el asfalto, autopistas rectas, pasos a nivel
    "roundabout_entrance": [
        "a road with a triangular yield or give way sign at a regular T-junction or crossroads with no circular island visible",
        "a straight highway or rural road with directional arrows painted on the asphalt but no roundabout circle ahead",
        "a road with a railway level crossing barrier ahead but no roundabout or circular island visible",
        "a driver's view of a lane change or merge on a straight road with no circular junction visible",
        "a bird's eye aerial view of a complete roundabout with vehicles circulating around a central island",
        "a vehicle already driving inside the roundabout with the central island to its side",
        "a road intersection or crossroads with traffic signs but no raised central circular island visible ahead",
    ],
    # moped no debe disparar en motos (ruedas grandes, depósito encima, cuadro rígido)
    # ni en bicicletas (sin motor, pedales visibles)
    "moped": [
        "a high-powered motorcycle with a large engine a prominent fuel tank on top large diameter wheels and a rider in full motorcycle leathers",
        "a sport or naked motorcycle with large 17-inch wheels a powerful engine and a frame clearly taller and heavier than a 50cc scooter",
        "a touring or adventure motorcycle with a conventional diamond frame large wheels panniers and an engine above 125cc",
        "a person pedalling a bicycle by foot with no engine motor exhaust or automatic transmission visible on the frame",
        "a bicycle with pedals and thin spoked wheels being ridden without any motorized components",
    ],
    # cyclist_on_road no debe disparar en diagramas de bici ni ciclistas en pistas cerradas
    "cyclist_on_road": [
        "a diagram or illustration of a bicycle with no real road or background context",
        "a top-down schematic of an intersection showing a bicycle symbol among other vehicle icons",
        "a cyclist on an indoor velodrome or dedicated cycling track with no motor vehicle traffic",
    ],
    # traffic_accident no debe disparar en adelantamientos normales ni tráfico denso
    # donde los coches están cerca pero sin colisión
    "traffic_accident": [
        "a car safely overtaking another vehicle on the road with both cars moving normally and no contact between them",
        "vehicles driving in heavy traffic or a traffic queue with cars close together but all moving normally without any collision",
        "a motorcycle or scooter riding alongside a car in normal traffic with no collision no contact and both riders in full control",
    ],
    # vehicle_breakdown no debe disparar en coches normales aparcados ni accidentes de colisión
    "vehicle_breakdown": [
        "a car driving normally on the road with all doors and boot closed and no visible mechanical problem",
        "a car parked in a car park or residential street with nothing unusual or broken visible",
        "a traffic accident with collision damage between two or more cars rather than a single stopped broken down vehicle",
    ],
}

NEG_WEIGHT: float = 0.5
