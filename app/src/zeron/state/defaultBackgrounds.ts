// Bundled session wallpapers. Sources are compressed copies of the
// repo-root defaultbackgrounds/ pack. Ids are stable and never shown
// in the UI.

export type DefaultBackgroundId =
  | 'img-1001'
  | 'alghozy'
  | 'emma'
  | 'julian-zwengel'
  | 'martin-bennie'
  | 'matteo-vella'
  | 'pascal-debrunner'
  | 'richard-lee'
  | 'scrapp-er'
  | 'met-museum';

export interface DefaultBackground {
  id: DefaultBackgroundId;
  source: number;
}

export const DEFAULT_BACKGROUNDS: readonly DefaultBackground[] = [
  {
    id: 'img-1001',
    source: require('../../../assets/backgrounds/img-1001.jpg'),
  },
  {
    id: 'alghozy',
    source: require('../../../assets/backgrounds/alghozy.jpg'),
  },
  {
    id: 'emma',
    source: require('../../../assets/backgrounds/emma.jpg'),
  },
  {
    id: 'julian-zwengel',
    source: require('../../../assets/backgrounds/julian-zwengel.jpg'),
  },
  {
    id: 'martin-bennie',
    source: require('../../../assets/backgrounds/martin-bennie.jpg'),
  },
  {
    id: 'matteo-vella',
    source: require('../../../assets/backgrounds/matteo-vella.jpg'),
  },
  {
    id: 'pascal-debrunner',
    source: require('../../../assets/backgrounds/pascal-debrunner.jpg'),
  },
  {
    id: 'richard-lee',
    source: require('../../../assets/backgrounds/richard-lee.jpg'),
  },
  {
    id: 'scrapp-er',
    source: require('../../../assets/backgrounds/scrapp-er.jpg'),
  },
  {
    id: 'met-museum',
    source: require('../../../assets/backgrounds/met-museum.jpg'),
  },
];

export const defaultBackgroundById = (
  id: string,
): DefaultBackground | undefined =>
  DEFAULT_BACKGROUNDS.find(item => item.id === id);
