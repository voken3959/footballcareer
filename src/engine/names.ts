export interface NationDef {
  code: string;
  name: string;
  strength: number; // international baseline
  first: string[];
  last: string[];
}

export const NATIONS: NationDef[] = [
  { code: 'ENG', name: 'England', strength: 78,
    first: ['Jack','Harry','Callum','Tom','Ethan','Luke','Mason','Reece','Connor','Oliver','Jamie','Liam','Ryan','Declan','Marcus','Kyle','Dean','Josh','Ben','Adam','Nathan','Jordan'],
    last: ['Walker','Hughes','Barnes','Carter','Fletcher','Hammond','Stevens','Gibson','Palmer','Hartley','Bennett','Marsh','Whitaker','Dawson','Holloway','Pearce','Sutton','Rowe','Cross','Ellison','Pritchard','Lowe'] },
  { code: 'SCO', name: 'Scotland', strength: 64,
    first: ['Callum','Angus','Fraser','Euan','Lewis','Craig','Gregor','Ross','Kenny','Stuart','Murray','Lachlan','Findlay','Alasdair','Rory','Cameron'],
    last: ['MacLeod','Campbell','Fraser','Gordon','Murray','Buchanan','Sinclair','Henderson','Kerr','Rennie','Drummond','Lennox','Baird','Crichton','Munro','Cochrane'] },
  { code: 'IRL', name: 'Ireland', strength: 60,
    first: ['Conor','Sean','Cian','Darragh','Eoin','Padraig','Niall','Fionn','Declan','Cathal','Ronan','Tadhg','Oisin','Brendan','Kieran','Colm'],
    last: ['Doyle','Brennan','Byrne','Gallagher','Kearney','Fitzgerald','Moran','Quigley','Healy','Duffy','Lynch','Delaney','Whelan','Nolan','Costello','Kavanagh'] },
  { code: 'FRA', name: 'France', strength: 82,
    first: ['Lucas','Hugo','Theo','Maxime','Antoine','Baptiste','Kylian','Rayan','Yanis','Clement','Nolan','Matteo','Enzo','Jules','Karim','Olivier','Mathis','Axel'],
    last: ['Moreau','Lefevre','Dubois','Girard','Fontaine','Lambert','Rousseau','Marchand','Chevalier','Barbier','Guerin','Benoit','Colin','Vidal','Perrin','Delmas','Roux','Lacroix'] },
  { code: 'ESP', name: 'Spain', strength: 80,
    first: ['Pablo','Alvaro','Hugo','Sergio','Marcos','Adrian','Diego','Iker','Raul','Nacho','Dani','Alex','Jorge','Mario','Ruben','Javi','Unai','Oscar'],
    last: ['Navarro','Castillo','Herrera','Ortega','Vidal','Serrano','Iglesias','Montero','Cabrera','Santana','Prieto','Rivas','Delgado','Marin','Cano','Esteban','Pascual','Rubio'] },
  { code: 'GER', name: 'Germany', strength: 79,
    first: ['Lukas','Jonas','Felix','Leon','Niklas','Tim','Florian','Moritz','Jannik','Kai','Lennart','Maximilian','Timo','Sven','Marlon','Fabian','Tobias','Emil'],
    last: ['Becker','Hoffmann','Schreiber','Vogel','Kruger','Brandt','Lehmann','Roth','Winkler','Seidel','Albrecht','Jager','Kessler','Neumann','Arnold','Ziegler','Hartmann','Engel'] },
  { code: 'ITA', name: 'Italy', strength: 76,
    first: ['Matteo','Lorenzo','Marco','Luca','Federico','Andrea','Davide','Gianluca','Simone','Riccardo','Alessio','Nicolo','Fabio','Stefano','Emanuele','Giacomo','Tommaso','Leonardo'],
    last: ['Rossi','Bellini','Conti','Ferrara','Greco','Marino','Ricci','Caruso','Bianchi','Santoro','Lombardi','Gentile','Fabbri','Barone','Palumbo','Moretti','Orlando','Serra'] },
  { code: 'NED', name: 'Netherlands', strength: 76,
    first: ['Daan','Sem','Luuk','Bram','Jesse','Thijs','Stijn','Ruben','Joris','Niels','Mees','Gijs','Teun','Floris','Wout','Sven'],
    last: ['De Vries','Van Dijk','Bakker','Jansen','Visser','Smit','Meijer','Mulder','Brouwer','Hendriks','Dekker','Van Leeuwen','Bos','Vermeulen','Kuipers','Peeters'] },
  { code: 'POR', name: 'Portugal', strength: 77,
    first: ['Tiago','Goncalo','Ruben','Joao','Diogo','Nuno','Bruno','Rafael','Andre','Miguel','Pedro','Vitor','Ricardo','Filipe','Rui','Hugo'],
    last: ['Silva','Ferreira','Costa','Pereira','Carvalho','Almeida','Teixeira','Moreira','Cardoso','Lopes','Barros','Ribeiro','Monteiro','Pinto','Marques','Faria'] },
  { code: 'BRA', name: 'Brazil', strength: 82,
    first: ['Gabriel','Matheus','Vinicius','Rodrigo','Thiago','Lucas','Felipe','Bruno','Caio','Leandro','Danilo','Willian','Everton','Renan','Igor','Fabricio'],
    last: ['Santos','Oliveira','Souza','Lima','Pereira','Barbosa','Araujo','Cavalcanti','Nascimento','Rocha','Moraes','Teixeira','Campos','Batista','Mendes','Duarte'] },
  { code: 'ARG', name: 'Argentina', strength: 82,
    first: ['Mateo','Nicolas','Facundo','Lautaro','Franco','Santiago','Joaquin','Emiliano','Tomas','Agustin','Thiago','Bautista','Ezequiel','Julian','Gonzalo','Ramiro'],
    last: ['Gimenez','Acosta','Romero','Molina','Sosa','Benitez','Medina','Aguirre','Paz','Ledesma','Ibarra','Cabral','Figueroa','Luna','Ponce','Dominguez'] },
  { code: 'NGA', name: 'Nigeria', strength: 70,
    first: ['Emeka','Chidi','Tunde','Kelechi','Ayo','Obinna','Femi','Segun','Ikenna','Tobi','Yusuf','Dayo','Nnamdi','Victor','Samuel','Chukwu'],
    last: ['Okafor','Adeyemi','Balogun','Eze','Okonkwo','Bello','Nwosu','Ogunleye','Abubakar','Onyeka','Salami','Ibrahim','Udoh','Oyelaran','Ezeh','Lawal'] },
  { code: 'GHA', name: 'Ghana', strength: 66,
    first: ['Kwame','Kofi','Yaw','Kojo','Nana','Ebo','Kwesi','Joseph','Emmanuel','Daniel','Isaac','Mensah','Baba','Samuel','Fiifi','Elvis'],
    last: ['Mensah','Owusu','Boateng','Asante','Appiah','Addo','Amoah','Quaye','Tetteh','Darko','Antwi','Frimpong','Badu','Ofori','Sarpong','Acheampong'] },
  { code: 'SEN', name: 'Senegal', strength: 70,
    first: ['Mamadou','Ousmane','Ibrahima','Cheikh','Moussa','Abdoulaye','Idrissa','Pape','Sadio','Boubacar','Amadou','Lamine','Souleymane','Alioune','Modou','Seydou'],
    last: ['Diop','Ndiaye','Fall','Sarr','Gueye','Diallo','Sow','Mbaye','Cisse','Faye','Thiam','Seck','Ba','Niang','Camara','Sy'] },
  { code: 'JPN', name: 'Japan', strength: 68,
    first: ['Haruto','Ren','Sota','Kaito','Yuto','Daiki','Takumi','Riku','Shun','Koki','Yuki','Hiroki','Ryota','Kenta','Naoki','Taiga'],
    last: ['Tanaka','Suzuki','Takahashi','Watanabe','Ito','Yamamoto','Nakamura','Kobayashi','Kato','Yoshida','Sasaki','Matsumoto','Inoue','Kimura','Hayashi','Shimizu'] },
  { code: 'USA', name: 'United States', strength: 66,
    first: ['Tyler','Jordan','Brandon','Austin','Cole','Trevor','Zach','Dylan','Caleb','Landon','Jalen','Chase','Connor','Wyatt','Miles','Devin'],
    last: ['Reynolds','Harper','Coleman','Bishop','Sullivan','Dixon','Stewart','Grant','Wallace','Burke','Holland','Fowler','Lambert','Stone','Webb','Booker'] },
];

export const NATION_BY_CODE: Record<string, NationDef> = Object.fromEntries(NATIONS.map((n) => [n.code, n]));
export const nationName = (code: string) => NATION_BY_CODE[code]?.name ?? code;

export const HOME_COUNTRY = 'ENG';
