import { Newsreader, Manrope, JetBrains_Mono } from 'next/font/google';
import './encounter.css';

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
  display: 'swap',
});

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export default function PathwayPreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${newsreader.variable} ${manrope.variable} ${jetbrainsMono.variable}`}>
      {children}
    </div>
  );
}
