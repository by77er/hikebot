/** Style guide: Avatar, for a user and a server, at both sizes, in each state. */
import { Avatar } from "../../components/avatar";
import { Section, StateList, type StyleguideSection } from "./section";

/** A picture made for the style guide, standing in for one from Discord. */
const SAMPLE = "/assets/cairn/samples/picture.svg";
/** A file that is not a valid picture, standing in for one that fails. */
const BROKEN = "/assets/cairn/samples/broken.svg";

function AvatarSection() {
  return (
    <Section
      id="avatar"
      title="Avatar"
      intro="A member's or a server's picture from Discord, with its initials behind it for when there is none or it does not load. Decorative next to the name; named by a label on its own."
    >
      <h3>Member</h3>
      <StateList
        examples={[
          {
            state: "Picture",
            example: <Avatar name="Ana Hiker" src={SAMPLE} />,
          },
          {
            state: "No picture",
            example: <Avatar name="Ana Hiker" src={null} />,
          },
          {
            state: "Picture failed",
            example: <Avatar name="Ana Hiker" src={BROKEN} />,
          },
          {
            state: "Small, picture",
            example: <Avatar name="Ana Hiker" src={SAMPLE} size="small" />,
          },
          {
            state: "Small, no picture",
            example: <Avatar name="Ana Hiker" src={null} size="small" />,
          },
        ]}
      />
      <h3>Server</h3>
      <StateList
        examples={[
          {
            state: "Icon",
            example: (
              <Avatar name="Ridge Walkers" src={SAMPLE} shape="square" />
            ),
          },
          {
            state: "No icon",
            example: <Avatar name="Ridge Walkers" src={null} shape="square" />,
          },
          {
            state: "Icon failed",
            example: (
              <Avatar name="Ridge Walkers" src={BROKEN} shape="square" />
            ),
          },
          {
            state: "Small, no icon",
            example: (
              <Avatar
                name="Ridge Walkers"
                src={null}
                shape="square"
                size="small"
              />
            ),
          },
          {
            state: "Labelled, no name beside it",
            example: (
              <Avatar
                name="Ridge Walkers"
                src={null}
                shape="square"
                label="Ridge Walkers"
              />
            ),
          },
        ]}
      />
    </Section>
  );
}

export const avatarSection: StyleguideSection = {
  id: "avatar",
  title: "Avatar",
  render: AvatarSection,
  ownPage: true,
};
