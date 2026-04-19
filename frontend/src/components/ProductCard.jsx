import React from 'react';

const ProductCard = ({ product }) => {
  const formatPrice = (price) => {
    if (!price) return null;
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      {/* Ảnh đại diện */}
      {product.imageUrl && (
        <img
          src={product.imageUrl}
          alt={product.productName}
          className="w-full h-36 object-cover"
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      )}

      <div className="p-4">
      {/* Tên sản phẩm + mention count */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-gray-900 text-sm leading-snug flex-1">
          {product.productName}
        </h3>
        <span className="shrink-0 text-xs bg-blue-50 text-blue-700 font-medium px-2 py-0.5 rounded-full">
          {product.mentionCount} bài
        </span>
      </div>

      {/* Mô tả */}
      {product.whatIsProduct && (
        <p className="text-xs text-gray-500 mb-2 line-clamp-2">{product.whatIsProduct}</p>
      )}

      {/* Giá */}
      {product.currentPrice && (
        <div className="flex items-center gap-1 mb-2">
          <span className="text-base font-bold text-green-600">
            {formatPrice(product.currentPrice)}
          </span>
        </div>
      )}

      {/* Khuyến mãi */}
      {product.whatIsPromotion && (
        <div className="bg-orange-50 border border-orange-100 rounded-lg px-2 py-1 mb-2">
          <p className="text-xs text-orange-700 line-clamp-2">🎁 {product.whatIsPromotion}</p>
        </div>
      )}

      {/* Footer: thời gian */}
      <div className="flex items-center justify-between text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100">
        <span>Lần đầu: {new Date(product.firstSeenAt).toLocaleDateString('vi-VN')}</span>
        <span>Gần nhất: {new Date(product.lastSeenAt).toLocaleDateString('vi-VN')}</span>
      </div>
      </div>
    </div>
  );
};

export default ProductCard;
