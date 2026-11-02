export default {
  multipass: true,
  js2svg: { pretty: true, indent: 2 },
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          cleanupIds: false,
          cleanupNumericValues: { floatPrecision: 6 },
          convertPathData: { floatPrecision: 6 },
          removeDesc: false,
        },
      },
    },
  ],
};
