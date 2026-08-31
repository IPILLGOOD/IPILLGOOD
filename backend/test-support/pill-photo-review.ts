// Only these nine reviewed public images are included in pill-photo-fixtures/images/.
// Changing this list requires source/rights/privacy and visual review; never accept a user-supplied manifest.
export const PILL_PHOTO_REVIEW_VERSION = "healthkr-pilot-2026-08-31-v1";
export const PILL_PHOTO_SOURCE_URL = "https://health.kr/notice/notice_view.asp?show_idx=1001";
export const PILL_PHOTO_FILES = [
  { path: "29002/IMG_20201202_163857.png", sha256: "d44bb3a9e1ddf0ff7ac821e5ee6c74d31d310b7d6f1c9ba979eea0c127f14c85", bytes: 568690 },
  { path: "29002/IMG_20201202_163933.png", sha256: "877d2339b191d5ebaf2f1758cc1a0208651967bc3f9e493691079f07238f4dd0", bytes: 522771 },
  { path: "40792/IMG_20201201_202814.png", sha256: "47c629f098958972e6004a913edf5edcdf29cdc1bc19a2e4d22c44f4c245eedf", bytes: 744249 },
  { path: "40792/IMG_20201201_202849.png", sha256: "3c154c4168030d4ce686143ed265c784ee5a08108d544856eead9ff85af419a5", bytes: 707947 },
  { path: "41107/IMG_20201117_204859.png", sha256: "94c6f62ea8a3c6b34248438dab8c19d7ebea36811d56fd62a87eb41dbebb8b76", bytes: 538051 },
  { path: "41107/IMG_20201117_204943.png", sha256: "52c49dde25291b364405e9d42aa97dc6ffdfe1814e02a0422a734fd27eeb94c9", bytes: 520175 },
  { path: "41344/IMG_20201120_002134.png", sha256: "1739ee7aab67343790a27c145432e3027b21dddbadc0b332c31328fe376a0be2", bytes: 406121 },
  { path: "41344/IMG_20201120_002100.png", sha256: "a9efdd71382105a974cb0b3d953f617c010149f207f678bb6f94f2df092e6651", bytes: 413440 },
  { path: "41107/IMG_20201117_204901.png", sha256: "6a44711f907dd00ad9105bccdb64cc769587090ea814533f3724a0318de86080", bytes: 404082 },
] as const;

export const PILL_PHOTO_EXPECTED_REJECTIONS: Readonly<Record<string, string>> = {
  "image-cutout": "image_artifact_or_uncertainty",
  "different-pills": "unverified_photo_pair",
};

// Expected IDs are for scoring AFTER inference. They must never enter the model request.
export const PILL_PHOTO_CASES = [
  { id: "soft-capsule", photos: [0, 1], expectedItemSeq: "201505259", kind: "candidate", receipt: "29002", evidenceUrl: "https://www.pharm.or.kr/search/drugidfy/show.asp?idx=36176" },
  { id: "two-color-capsule", photos: [2, 3], expectedItemSeq: "201800300", kind: "candidate", receipt: "40792", evidenceUrl: "https://pharm.or.kr/search/drugidfy/show.asp?idx=48009" },
  { id: "printed-band-capsule", photos: [4, 5], expectedItemSeq: "201906970", kind: "candidate", receipt: "41107", evidenceUrl: "https://www.pharm.or.kr/search/drugidfy/show.asp?idx=48324" },
  { id: "oval-tablet", photos: [6, 7], expectedItemSeq: "200801352", kind: "candidate", receipt: "41344", evidenceUrl: "https://pharm.or.kr/search/drugidfy/show.asp?idx=48561" },
  { id: "image-cutout", photos: [8, 5], expectedItemSeq: null, kind: "reject", receipt: "41107", evidenceUrl: "https://www.pharm.or.kr/search/drugidfy/show.asp?idx=48324" },
  { id: "different-pills", photos: [0, 7], expectedItemSeq: null, kind: "reject", receipt: null, evidenceUrl: null },
] as const;
