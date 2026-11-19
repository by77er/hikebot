/** Style guide: Pagination on the first, a middle and the last page. */
import { Pagination } from "../../components/pagination";
import { ExampleList, Section, type StyleguideSection } from "./section";

const page = (number: number) =>
  `/styleguide/pagination?page=${String(number)}`;

function PaginationSection() {
  return (
    <Section
      id="pagination"
      title="Pagination"
      intro="Newer and Older, as the bot's hike log says, with the position in words. At an end, the direction that does not exist is shown disabled, as in Discord."
    >
      <ExampleList
        examples={[
          {
            state: "First page: nothing newer",
            example: (
              <Pagination
                label="Hike log pages, first example"
                position="43 hikes · page 1 of 5"
                older={page(2)}
              />
            ),
          },
          {
            state: "A middle page",
            example: (
              <Pagination
                label="Hike log pages, middle example"
                position="43 hikes · page 2 of 5"
                newer={page(1)}
                older={page(3)}
              />
            ),
          },
          {
            state: "Last page: nothing older",
            example: (
              <Pagination
                label="Hike log pages, last example"
                position="43 hikes · page 5 of 5"
                newer={page(4)}
              />
            ),
          },
          {
            state: "A long position",
            example: (
              <Pagination
                label="Hike log pages, long example"
                position="1,043 hikes · page 104 of 105"
                newer={page(103)}
                older={page(105)}
              />
            ),
          },
        ]}
      />
    </Section>
  );
}

export const paginationSection: StyleguideSection = {
  id: "pagination",
  title: "Pagination",
  render: PaginationSection,
  ownPage: true,
};
