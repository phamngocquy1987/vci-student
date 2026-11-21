// Optimize supplied school images for the app without changing their design.
import sharp from 'sharp';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const logo=process.argv[2],campus=process.argv[3];
if(!logo||!campus)throw new Error('Pass the original logo and campus image paths.');
const web=path.join(root,'admin/brand');
const assets=path.join(root,'ios/VCIStudent/Assets.xcassets');
await mkdir(web,{recursive:true});
await mkdir(assets,{recursive:true});
await sharp(logo).resize(512,512,{fit:'inside',withoutEnlargement:true}).png({compressionLevel:9}).toFile(path.join(web,'school-logo.png'));
await sharp(campus).resize({width:1600,withoutEnlargement:true}).webp({quality:88}).toFile(path.join(web,'campus.webp'));
for(const [name,filename] of [['SchoolLogo','school-logo.png'],['CampusBackground','campus.jpg']]){
  const dir=path.join(assets,`${name}.imageset`);
  await mkdir(dir,{recursive:true});
  if(name==='SchoolLogo')await copyFile(path.join(web,filename),path.join(dir,filename));
  else await sharp(campus).resize({width:1600,withoutEnlargement:true}).jpeg({quality:90,mozjpeg:true}).toFile(path.join(dir,filename));
  await writeFile(path.join(dir,'Contents.json'),JSON.stringify({images:[{filename,idiom:'universal',scale:'1x'}],info:{author:'xcode',version:1}},null,2));
}
const icon=path.join(assets,'AppIcon.appiconset');
await mkdir(icon,{recursive:true});
await sharp(logo).resize(880,880,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).extend({top:72,bottom:72,left:72,right:72,background:'#ffffff'}).png({compressionLevel:9}).toFile(path.join(icon,'AppIcon.png'));
await writeFile(path.join(icon,'Contents.json'),JSON.stringify({images:[{filename:'AppIcon.png',idiom:'universal',platform:'ios',size:'1024x1024'}],info:{author:'xcode',version:1}},null,2));
await copyFile(path.join(icon,'AppIcon.png'),path.join(web,'app-icon.png'));
await writeFile(path.join(assets,'Contents.json'),JSON.stringify({info:{author:'xcode',version:1}},null,2));
console.log('Prepared school logo, campus background and iOS app icon. Original files were only read.');
