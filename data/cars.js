// Phase 9 note:
// 当前仍使用本地 mock 数据驱动车辆展示。
// 后续如接入云数据库，可保持当前字段不变，将这里替换为云端返回结果的标准化映射层。
// 建议云端字段继续保持：
// id, name, nickname, brand, category, priceDay, priceText,
// status, statusText, location, tags, transmission, fuelType,
// seats, cover, images, description, sort
const cars = [
  {
    id: "car_001",
    name: "MX-5 ND2",
    nickname: "北极星",
    brand: "Mazda",
    category: "supercar",
    priceDay: 599,
    priceText: "今日 ￥599 / 24小时",
    status: "available",
    statusText: "在库",
    location: "杭州",
    tags: ["手动挡", "软顶敞篷"],
    transmission: "manual",
    fuelType: "gasoline",
    seats: 2,
    cover: "/assets/cars/car_001_cover.jpg",
    images: [
      "/assets/cars/car_001_01.jpg",
      "/assets/cars/car_001_02.jpg"
    ],
    description: "轻量化双座敞篷跑车，适合城市周边驾驶体验。",
    sort: 1
  },
  {
    id: "car_002",
    name: "MINI Cooper S",
    nickname: "赤焰豆丁",
    brand: "MINI",
    category: "luxury_sedan",
    priceDay: 699,
    priceText: "今日 ￥699 / 24小时",
    status: "reserved",
    statusText: "已预约",
    location: "杭州",
    tags: ["两厢钢炮", "城市灵动"],
    transmission: "automatic",
    fuelType: "gasoline",
    seats: 4,
    cover: "/assets/cars/car_002_cover.jpg",
    images: [
      "/assets/cars/car_002_01.jpg",
      "/assets/cars/car_002_02.jpg"
    ],
    description: "小巧灵活的性能小车，适合城市穿梭和周边短途驾驶。",
    sort: 2
  },
  {
    id: "car_003",
    name: "BMW 740Li",
    nickname: "夜幕领航",
    brand: "BMW",
    category: "luxury_sedan",
    priceDay: 1299,
    priceText: "今日 ￥1299 / 24小时",
    status: "available",
    statusText: "在库",
    location: "杭州",
    tags: ["行政旗舰", "后排舒享"],
    transmission: "automatic",
    fuelType: "gasoline",
    seats: 5,
    cover: "/assets/cars/car_003_cover.jpg",
    images: [
      "/assets/cars/car_003_01.jpg",
      "/assets/cars/car_003_02.jpg"
    ],
    description: "豪华行政轿车，适合商务接待与高规格出行体验。",
    sort: 3
  },
  {
    id: "car_004",
    name: "Porsche 718 Cayman",
    nickname: "弯心猎手",
    brand: "Porsche",
    category: "supercar",
    priceDay: 1499,
    priceText: "今日 ￥1499 / 24小时",
    status: "maintenance",
    statusText: "维护中",
    location: "杭州",
    tags: ["中置后驱", "操控取向"],
    transmission: "automatic",
    fuelType: "gasoline",
    seats: 2,
    cover: "/assets/cars/car_004_cover.jpg",
    images: [
      "/assets/cars/car_004_01.jpg",
      "/assets/cars/car_004_02.jpg"
    ],
    description: "中置跑车布局带来直接灵敏的操控反馈，适合追求驾驶感的人群。",
    sort: 4
  },
  {
    id: "car_005",
    name: "Ford Mustang 5.0",
    nickname: "机械回响",
    brand: "Ford",
    category: "supercar",
    priceDay: 1099,
    priceText: "今日 ￥1099 / 24小时",
    status: "rented",
    statusText: "已租出",
    location: "杭州",
    tags: ["V8声浪", "美式肌肉"],
    transmission: "automatic",
    fuelType: "gasoline",
    seats: 4,
    cover: "/assets/cars/car_005_cover.jpg",
    images: [
      "/assets/cars/car_005_01.jpg",
      "/assets/cars/car_005_02.jpg"
    ],
    description: "经典燃油性能车，具备鲜明机械感和高辨识度巡航气质。",
    sort: 5
  }
]

module.exports = cars
