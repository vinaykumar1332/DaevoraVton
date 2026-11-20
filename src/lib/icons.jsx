import {
  Copy,
  Globe,
  IdCard,
  ImageIcon,
  LayoutGrid,
  Maximize,
  Maximize2,
  Network,
  Pencil,
  CirclePlus,
  RefreshCw,
  Sparkles,
  Star,
  Tag,
  User,
  Zap,
} from 'lucide-react';

// Workflow definitions (engines.js, outfitModes.js) refer to icons by these names.
const ICONS = { Copy, Globe, IdCard, ImageIcon, LayoutGrid, Maximize, Maximize2, Network, Pencil, CirclePlus, RefreshCw, Sparkles, Star, Tag, User, Zap };

export function WfIcon({ name, ...props }) {
  const Cmp = ICONS[name] ?? Sparkles;
  return <Cmp aria-hidden="true" {...props} />;
}
